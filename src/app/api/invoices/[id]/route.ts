import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { listInvoices, today } from '@/lib/finance'
import { isValidIsoDate } from '@/lib/billing'
import { errorResponse } from '@/lib/apiError'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'finance.manage')
    const [invoice] = await listInvoices(profile.org_id, { id: params.id })
    if (!invoice) throw new ApiError(404, 'Invoice not found')
    const svc = supabaseService()
    const [payments, chases] = await Promise.all([
      svc.from('payments').select('id, amount, paid_on, method, reference, created_at, recorded_by:profiles!recorded_by(full_name)').eq('invoice_id', params.id).order('paid_on'),
      svc.from('invoice_chases').select('id, note, created_at, chased_by:profiles!chased_by(full_name)').eq('invoice_id', params.id).order('created_at', { ascending: false })
    ])
    if (payments.error) throw new ApiError(400, payments.error.message)
    if (chases.error) throw new ApiError(400, chases.error.message)
    return NextResponse.json({ ...invoice, payments: payments.data ?? [], chases: chases.data ?? [] })
  } catch (err) { return errorResponse(err) }
}

/** { action: 'issue', due_date? } or { action: 'void' }. A void invoice is final; one with payments can't be voided (the database also refuses). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'finance.manage')
    const body = await req.json().catch(() => ({}))
    if (!['issue', 'void'].includes(body.action)) throw new ApiError(400, "action must be 'issue' or 'void'")
    const svc = supabaseService()
    const { data: inv } = await svc.from('invoices').select('id, status, due_date').eq('id', params.id).eq('org_id', profile.org_id).single()
    if (!inv) throw new ApiError(404, 'Invoice not found')

    let patch: Record<string, unknown>
    if (body.action === 'issue') {
      if (inv.status !== 'draft') throw new ApiError(400, `Only a draft can be issued (this one is ${inv.status})`)
      const due = body.due_date ?? inv.due_date
      if (!due) throw new ApiError(400, 'A due date is required to issue an invoice')
      if (!isValidIsoDate(String(due))) throw new ApiError(400, 'due_date must be a valid date (YYYY-MM-DD)')
      patch = { status: 'issued', issue_date: today(), due_date: due }
    } else {
      if (inv.status === 'void') throw new ApiError(400, 'Already void')
      patch = { status: 'void' }
    }
    const { error } = await svc.from('invoices').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', params.id).eq('org_id', profile.org_id)
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: `invoice_${body.action}d`, entityType: 'invoice', entityId: params.id, before: { status: inv.status }, after: patch })
    const [updated] = await listInvoices(profile.org_id, { id: params.id })
    return NextResponse.json(updated)
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
