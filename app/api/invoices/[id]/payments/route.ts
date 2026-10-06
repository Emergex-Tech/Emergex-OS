import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { listInvoices, today } from '@/lib/finance'
import { toCents, isValidIsoDate } from '@/lib/billing'
import { errorResponse } from '@/lib/apiError'

/** B9. The friendly checks below are only for good error messages — the database trigger is the real guarantee. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'finance.manage')
    const body = await req.json().catch(() => ({}))
    const cents = toCents(body.amount)
    if (!Number.isFinite(cents) || cents <= 0) throw new ApiError(400, 'amount must be a positive number')
    if (body.paid_on && !isValidIsoDate(String(body.paid_on))) throw new ApiError(400, 'paid_on must be a valid date (YYYY-MM-DD)')

    const [inv] = await listInvoices(profile.org_id, { id: params.id })
    if (!inv) throw new ApiError(404, 'Invoice not found')
    if (inv.status !== 'issued') throw new ApiError(400, `Payments can only be recorded against an issued invoice (this one is ${inv.status})`)
    if (cents > toCents(inv.balance)) throw new ApiError(400, `That is more than the outstanding balance of ${inv.currency} ${inv.balance.toLocaleString()}`)

    const svc = supabaseService()
    const { data: payment, error } = await svc.from('payments').insert({
      org_id: profile.org_id, invoice_id: params.id, amount: cents / 100, paid_on: body.paid_on ?? today(),
      method: body.method ?? null, reference: body.reference ?? null, recorded_by: profile.id
    }).select('id').single()
    if (error) throw new ApiError(400, error.message) // e.g. the trigger caught a concurrent overpayment
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'payment_recorded', entityType: 'invoice', entityId: params.id, after: { amount: cents / 100, payment_id: payment.id } })
    const [updated] = await listInvoices(profile.org_id, { id: params.id })
    return NextResponse.json(updated, { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
