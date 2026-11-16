import { supabaseService } from './supabaseServer'
import { OPEN_STAGES, DEFAULT_WEIGHTS, type RevDeal, type RevInvoice, type RevPayment, type OpenProposal, type PlanRow } from './revenue'

type LineRow = { id: string; proposal_id: string; sell_price: number | null; quantity: number | null; items: { properties: { category_key: string | null; market: string | null; vendors: { name: string } | null } | null } | null }
const n = (v: unknown) => (v == null ? 0 : Number(v))

/** Everything the revenue view is calculated from, for one organisation. Read with the service role; the route decides who may see it. */
export async function loadRevenueData(orgId: string): Promise<{ deals: RevDeal[]; invoices: RevInvoice[]; payments: RevPayment[]; open: OpenProposal[]; currencies: string[] }> {
  const svc = supabaseService()
  const { data: contracts } = await svc.from('contracts')
    .select('id, deal_id, final_amount, currency, created_at, booked_on, deals(proposal_id, proposals(id, brands(name), routes(route_type, agents(name)), creator:profiles!proposals_created_by_fkey(full_name)))')
    .eq('org_id', orgId).limit(5000)
  type C = { id: string; deal_id: string; final_amount: number | null; currency: string | null; created_at: string; booked_on: string | null; deals: { proposal_id: string | null; proposals: { id: string; brands: { name: string } | null; routes: { route_type: string; agents: { name: string } | null } | null; creator: { full_name: string } | null } | null } | null }
  const cs = (contracts ?? []) as unknown as C[]
  const dealIds = cs.map((c) => c.deal_id)
  const { data: projects } = dealIds.length ? await svc.from('projects').select('deal_id, owner:profiles!projects_owner_id_fkey(full_name)').in('deal_id', dealIds) : { data: [] }
  const ownerByDeal = new Map(((projects ?? []) as unknown as { deal_id: string; owner: { full_name: string } | null }[]).map((p) => [p.deal_id, p.owner?.full_name ?? null]))

  const { data: openRows } = await svc.from('proposals').select('id, stage, currency, budget').eq('org_id', orgId).in('stage', OPEN_STAGES as unknown as string[]).limit(5000)
  const proposalIds = [...cs.map((c) => c.deals?.proposal_id).filter((x): x is string => !!x), ...(openRows ?? []).map((p) => p.id as string)]
  const lines: LineRow[] = []
  for (let i = 0; i < proposalIds.length; i += 200) {
    const { data } = await svc.from('proposal_lines').select('id, proposal_id, sell_price, quantity, items(properties(category_key, market, vendors(name)))').in('proposal_id', proposalIds.slice(i, i + 200))
    lines.push(...((data ?? []) as unknown as LineRow[]))
  }
  const pricing = new Map<string, { cost_used: number | null; agent_cut_amount: number | null }>()
  const lineIds = lines.map((l) => l.id)
  for (let i = 0; i < lineIds.length; i += 200) {
    const { data } = await svc.from('proposal_line_pricing').select('proposal_line_id, cost_used, agent_cut_amount').in('proposal_line_id', lineIds.slice(i, i + 200))
    for (const p of data ?? []) pricing.set(p.proposal_line_id, { cost_used: p.cost_used == null ? null : Number(p.cost_used), agent_cut_amount: p.agent_cut_amount == null ? null : Number(p.agent_cut_amount) })
  }
  const byProposal = new Map<string, LineRow[]>(); for (const l of lines) byProposal.set(l.proposal_id, [...(byProposal.get(l.proposal_id) ?? []), l])

  const deals: RevDeal[] = cs.map((c) => {
    const p = c.deals?.proposals
    return {
      contractId: c.id, currency: c.currency ?? 'USD', bookedOn: c.booked_on ?? c.created_at.slice(0, 10), finalAmount: n(c.final_amount),
      brand: p?.brands?.name ?? null, agent: p?.routes?.route_type === 'via_agent' ? (p.routes.agents?.name ?? 'Agent') : 'Direct', owner: ownerByDeal.get(c.deal_id) ?? p?.creator?.full_name ?? null,
      lines: (byProposal.get(c.deals?.proposal_id ?? '') ?? []).map((l) => {
        const q = n(l.quantity) || 1, pr = pricing.get(l.id)
        return { revenue: n(l.sell_price) * q, cost: pr?.cost_used == null ? null : pr.cost_used * q, agentCut: pr?.cost_used == null ? null : n(pr.agent_cut_amount) * q,     // everything stored per unit
          category: l.items?.properties?.category_key ?? null, market: l.items?.properties?.market ?? null, vendor: l.items?.properties?.vendors?.name ?? null }
      })
    }
  })
  const open: OpenProposal[] = (openRows ?? []).map((p) => {
    const value = (byProposal.get(p.id) ?? []).reduce((s, l) => s + n(l.sell_price) * (n(l.quantity) || 1), 0)
    return value > 0 ? { stage: p.stage, currency: p.currency ?? 'USD', value, estimated: false } : { stage: p.stage, currency: p.currency ?? 'USD', value: n(p.budget), estimated: true }   // no priced lines yet: its budget stands in
  })
  const { data: inv } = await svc.from('invoices').select('id, direction, status, amount, currency, issue_date').eq('org_id', orgId).limit(20000)
  const invoices: RevInvoice[] = (inv ?? []).map((i) => ({ id: i.id, direction: i.direction, status: i.status, amount: n(i.amount), currency: i.currency ?? 'USD', issueDate: i.issue_date }))
  const { data: pay } = await svc.from('payments').select('invoice_id, amount, paid_on').eq('org_id', orgId).limit(20000)
  const payments: RevPayment[] = (pay ?? []).map((p) => ({ invoiceId: p.invoice_id, amount: n(p.amount), paidOn: p.paid_on }))
  const currencies = Array.from(new Set([...deals.map((d) => d.currency), ...invoices.map((i) => i.currency), ...open.map((o) => o.currency)])).sort()
  return { deals, invoices, payments, open, currencies }
}

export async function loadWeights(orgId: string): Promise<Record<string, number>> {
  const { data } = await supabaseService().from('pipeline_stage_weights').select('stage, weight_pct').eq('org_id', orgId)
  return { ...DEFAULT_WEIGHTS, ...Object.fromEntries((data ?? []).map((w) => [w.stage, Number(w.weight_pct)])) }
}
export async function loadPlan(orgId: string, currency: string, from: string, to: string): Promise<PlanRow[]> {
  const { data } = await supabaseService().from('revenue_plan').select('period, booked_target, collected_target').eq('org_id', orgId).eq('currency', currency).gte('period', `${from}-01`).lte('period', `${to}-01`).order('period')
  return (data ?? []).map((p) => ({ period: String(p.period).slice(0, 7), booked_target: Number(p.booked_target), collected_target: p.collected_target == null ? null : Number(p.collected_target) }))
}
