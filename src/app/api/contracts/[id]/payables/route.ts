import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { buildPayables, fromCents, invoiceNumber, isValidIsoDate, type PayableLine } from '@/lib/billing'
import { errorResponse } from '@/lib/apiError'

/**
 * B8: payables to vendors and agents, derived from what the won deal actually cost. This reads
 * cost and agent-cut figures (margin-side data), so it needs margin.view as well as finance.manage.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'finance.manage')
    await requirePermission(profile, 'margin.view')
    const body = await req.json().catch(() => ({}))
    if (body.due_date && !isValidIsoDate(String(body.due_date))) throw new ApiError(400, 'due_date must be a valid date (YYYY-MM-DD)')
    const svc = supabaseService()

    const { data: contract } = await svc.from('contracts').select('id, currency, deals(proposal_id)').eq('id', params.id).eq('org_id', profile.org_id).single()
    if (!contract) throw new ApiError(404, 'Contract not found')
    const proposalId = (contract.deals as unknown as { proposal_id: string } | null)?.proposal_id
    if (!proposalId) throw new ApiError(400, 'This contract\'s deal has no proposal to derive costs from')

    const existing = await svc.from('invoices').select('id', { count: 'exact', head: true }).eq('contract_id', params.id).eq('direction', 'payable').neq('status', 'void')
    if ((existing.count ?? 0) > 0) throw new ApiError(409, 'This contract already has payables. Void them first if you need to regenerate.')

    const { data: proposal } = await svc.from('proposals').select('route_id, routes(agent_id, cut_method, cut_pct, fixed_fee, agents(name, cut_method, fixed_fee))').eq('id', proposalId).single()
    const { data: lines, error: lineError } = await svc.from('proposal_lines')
      .select('id, quantity, items(properties(vendor_id, vendors(name)))').eq('proposal_id', proposalId)
    if (lineError) throw new ApiError(400, lineError.message)
    const { data: pricing } = await svc.from('proposal_line_pricing').select('proposal_line_id, cost_used, agent_cut_amount').in('proposal_line_id', (lines ?? []).map((l) => l.id))
    const priceByLine = new Map((pricing ?? []).map((p) => [p.proposal_line_id, p]))

    const payableLines: PayableLine[] = (lines ?? []).map((l) => {
      const prop = (l.items as unknown as { properties: { vendor_id: string | null; vendors: { name: string } | null } | null } | null)?.properties
      const pr = priceByLine.get(l.id)
      return { vendorId: prop?.vendor_id ?? null, vendorName: prop?.vendors?.name ?? null, quantity: Number(l.quantity), costUsed: Number(pr?.cost_used ?? 0), agentCutAmount: Number(pr?.agent_cut_amount ?? 0) }
    })

    // Route-level cut config overrides the agent's own default (A7), same rule the pricing screens use.
    const route = proposal?.routes as unknown as { agent_id: string | null; cut_method: string | null; fixed_fee: number | null; agents: { name: string; cut_method: string; fixed_fee: number } | null } | null
    const agent = route?.agent_id ? {
      id: route.agent_id, name: route.agents?.name ?? null,
      cutMethod: route.cut_method ?? route.agents?.cut_method ?? 'none', fixedFee: Number(route.fixed_fee ?? route.agents?.fixed_fee ?? 0)
    } : null

    const { payables, unassignedLines } = buildPayables(payableLines, agent)
    if (payables.length === 0) throw new ApiError(400, 'Nothing is payable on this contract (no costs or agent commission recorded).')

    const { data: created, error } = await svc.from('invoices').insert(payables.map((p) => ({
      org_id: profile.org_id, contract_id: params.id, direction: 'payable', counterparty_type: p.counterpartyType, counterparty_id: p.counterpartyId,
      counterparty_name: p.counterpartyName, description: p.description, amount: fromCents(p.amountCents), currency: contract.currency,
      due_date: body.due_date ?? null, created_by: profile.id
    }))).select('id, seq_no, counterparty_name, counterparty_type, amount')
    if (error) throw new ApiError(400, error.message)

    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'payables_created', entityType: 'contract', entityId: params.id, after: { count: payables.length, unassigned_lines: unassignedLines } })
    return NextResponse.json({
      payables: (created ?? []).map((i) => ({ id: i.id, number: invoiceNumber('payable', i.seq_no), counterparty: i.counterparty_name, type: i.counterparty_type, amount: Number(i.amount) })),
      warning: unassignedLines > 0 ? `${unassignedLines} line(s) have no vendor recorded on their property and were grouped under "Unassigned vendor".` : null
    }, { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
