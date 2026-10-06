import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { buildSchedule, toCents, fromCents, invoiceNumber } from '@/lib/billing'
import { errorResponse } from '@/lib/apiError'

/** B6 + B7: turn a contract into a billing schedule — draft receivable invoices that sum to exactly the contract total. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'finance.manage')
    const body = await req.json().catch(() => ({}))
    const svc = supabaseService()

    const { data: contract } = await svc.from('contracts')
      .select('id, final_amount, currency, deals(proposals(brand_id, brands(name)))')
      .eq('id', params.id).eq('org_id', profile.org_id).single()
    if (!contract) throw new ApiError(404, 'Contract not found')

    const existing = await svc.from('invoices').select('id', { count: 'exact', head: true })
      .eq('contract_id', params.id).eq('direction', 'receivable').neq('status', 'void')
    if ((existing.count ?? 0) > 0) throw new ApiError(409, 'This contract already has a billing schedule. Void its invoices first if you need to regenerate it.')

    let schedule
    try {
      schedule = buildSchedule({
        totalCents: toCents(contract.final_amount), installments: Number(body.installments ?? 1),
        firstDueDate: String(body.first_due_date ?? ''), intervalMonths: Number(body.interval_months ?? 1)
      })
    } catch (e) { throw new ApiError(400, e instanceof Error ? e.message : 'Invalid schedule') }

    // Receivable from the brand by default; "receivables from brands or agents" (PRD 6.15) — an agent can be billed instead.
    const proposal = (contract.deals as unknown as { proposals: { brand_id: string; brands: { name: string } | null } | null } | null)?.proposals
    let cp = { type: 'brand', id: proposal?.brand_id ?? null, name: proposal?.brands?.name ?? 'Brand' }
    if (body.counterparty?.type === 'agent') {
      const { data: agent } = await svc.from('agents').select('id, name').eq('id', body.counterparty.id).eq('org_id', profile.org_id).maybeSingle()
      if (!agent) throw new ApiError(400, 'That agent does not exist')
      cp = { type: 'agent', id: agent.id, name: agent.name }
    }

    const { data: created, error } = await svc.from('invoices').insert(schedule.map((s) => ({
      org_id: profile.org_id, contract_id: params.id, direction: 'receivable', counterparty_type: cp.type, counterparty_id: cp.id,
      counterparty_name: cp.name, description: `Instalment ${s.seq} of ${schedule.length}`, amount: fromCents(s.amountCents),
      currency: contract.currency, due_date: s.dueDate, created_by: profile.id
    }))).select('id, seq_no, amount, due_date')
    if (error) throw new ApiError(400, error.message)

    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'billing_schedule_created', entityType: 'contract', entityId: params.id, after: { installments: schedule.length } })
    return NextResponse.json({ invoices: (created ?? []).map((i) => ({ id: i.id, number: invoiceNumber('receivable', i.seq_no), amount: Number(i.amount), due_date: i.due_date })) }, { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
