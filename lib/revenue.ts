// Revenue management (PRD 6.23) — PURE arithmetic, no database. Everything here is CALCULATED from records that already exist
// (contracts, invoices, payments, proposal lines); nothing is typed in except the plan and the stage weights.
// Currencies are NEVER added together: every function works on one currency at a time.

export const OPEN_STAGES = ['Draft', 'Review', 'Approved', 'Sent', 'Negotiating'] as const
/** How likely a proposal at each stage is to be won. A starting point — the CEO can change them. */
export const DEFAULT_WEIGHTS: Record<string, number> = { Draft: 10, Review: 20, Approved: 35, Sent: 50, Negotiating: 75 }

export interface RevLine { revenue: number; cost: number | null; agentCut: number | null; category: string | null; market: string | null; vendor: string | null }
export interface RevDeal { contractId: string; currency: string; bookedOn: string; finalAmount: number; brand: string | null; agent: string | null; owner: string | null; lines: RevLine[] }
export interface RevInvoice { id: string; direction: 'receivable' | 'payable'; status: 'draft' | 'issued' | 'void'; amount: number; currency: string; issueDate: string | null }
export interface RevPayment { invoiceId: string; amount: number; paidOn: string }
export type Dimension = 'brand' | 'agent' | 'owner' | 'category' | 'market' | 'vendor'
export const DIMENSIONS: Dimension[] = ['brand', 'agent', 'market', 'category', 'vendor', 'owner']

const r2 = (n: number) => Math.round(n * 100) / 100
const r1 = (n: number) => Math.round(n * 10) / 10
export const isMonth = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
export const monthOf = (isoDay: string) => isoDay.slice(0, 7)
/** Every month from `from` to `to` inclusive ("2026-11" … "2027-02"). Empty if the range is backwards. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []; let [y, m] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++ }; if (out.length > 120) break }
  return out
}
/** The 12 months ending with the month of `today`. */
export function defaultRange(today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number); const start = y * 12 + (m - 1) - 11
  return { from: `${Math.floor(start / 12)}-${String((start % 12) + 1).padStart(2, '0')}`, to: `${y}-${String(m).padStart(2, '0')}` }
}

export interface MonthRow { month: string; booked: number; invoiced: number; collected: number }
/**
 * BOOKED  = the value of contracts, in the month the deal was signed.
 * INVOICED = receivable invoices that have been ISSUED (drafts and voided invoices are not revenue), in the month of issue.
 * COLLECTED = payments received against receivable invoices that are not void, in the month they were paid.
 * `outstanding` is everything ever invoiced and not yet collected — as of now, not limited to the months shown.
 */
export function revenueByMonth(deals: RevDeal[], invoices: RevInvoice[], payments: RevPayment[], currency: string, months: string[]): { months: MonthRow[]; totals: { booked: number; invoiced: number; collected: number }; outstanding: number } {
  const rows = new Map(months.map((m) => [m, { month: m, booked: 0, invoiced: 0, collected: 0 }]))
  for (const d of deals) if (d.currency === currency) { const r = rows.get(monthOf(d.bookedOn)); if (r) r.booked += d.finalAmount }
  const rec = new Map(invoices.filter((i) => i.direction === 'receivable' && i.currency === currency && i.status !== 'void').map((i) => [i.id, i]))
  let allInvoiced = 0, allCollected = 0
  for (const i of rec.values()) if (i.status === 'issued') { allInvoiced += i.amount; if (i.issueDate) { const r = rows.get(monthOf(i.issueDate)); if (r) r.invoiced += i.amount } }
  for (const p of payments) if (rec.has(p.invoiceId)) { allCollected += p.amount; const r = rows.get(monthOf(p.paidOn)); if (r) r.collected += p.amount }
  const list = months.map((m) => { const r = rows.get(m)!; return { month: m, booked: r2(r.booked), invoiced: r2(r.invoiced), collected: r2(r.collected) } })
  return { months: list, totals: { booked: r2(list.reduce((s, r) => s + r.booked, 0)), invoiced: r2(list.reduce((s, r) => s + r.invoiced, 0)), collected: r2(list.reduce((s, r) => s + r.collected, 0)) }, outstanding: r2(allInvoiced - allCollected) }
}

export interface MarginRow { key: string; deals: number; revenue: number; cost: number; gross: number; net: number; gross_pct: number | null; net_pct: number | null; unknown_cost_revenue: number }
/**
 * Margin by one dimension. GROSS = revenue − what the vendor is paid. NET = gross − the agent's cut.
 * A line whose cost is unknown (a deal entered as already running) counts towards revenue but NOT towards margin — its revenue is
 * shown separately as "cost unknown", and the percentages are taken only over revenue whose cost is known. Guessing a cost would
 * make every margin figure on the page untrustworthy.
 */
export function marginByDimension(deals: RevDeal[], currency: string, dim: Dimension, months?: string[]): MarginRow[] {
  const inRange = months ? new Set(months) : null
  const acc = new Map<string, { contracts: Set<string>; revenue: number; known: number; cost: number; cut: number }>()
  const add = (key: string | null, contract: string, l: RevLine) => {
    const k = key && key.trim() ? key.trim() : '(not set)'
    const a = acc.get(k) ?? { contracts: new Set<string>(), revenue: 0, known: 0, cost: 0, cut: 0 }
    a.contracts.add(contract); a.revenue += l.revenue
    if (l.cost != null) { a.known += l.revenue; a.cost += l.cost; a.cut += l.agentCut ?? 0 }
    acc.set(k, a)
  }
  for (const d of deals) {
    if (d.currency !== currency || (inRange && !inRange.has(monthOf(d.bookedOn)))) continue
    for (const l of d.lines) add(dim === 'brand' ? d.brand : dim === 'agent' ? d.agent : dim === 'owner' ? d.owner : dim === 'category' ? l.category : dim === 'market' ? l.market : l.vendor, d.contractId, l)
  }
  return Array.from(acc.entries()).map(([key, a]) => { const gross = a.known - a.cost, net = gross - a.cut
    return { key, deals: a.contracts.size, revenue: r2(a.revenue), cost: r2(a.cost), gross: r2(gross), net: r2(net), gross_pct: a.known > 0 ? r1((gross / a.known) * 100) : null, net_pct: a.known > 0 ? r1((net / a.known) * 100) : null, unknown_cost_revenue: r2(a.revenue - a.known) }
  }).sort((x, y) => y.revenue - x.revenue || x.key.localeCompare(y.key))
}

/** Contracts whose value no longer equals the sum of their lines (the lines were changed after the contract was made). Booked uses the contract; margin uses the lines — so these are worth knowing about. */
export function reconciliation(deals: RevDeal[], currency: string): { contractId: string; brand: string | null; contract: number; lines: number }[] {
  return deals.filter((d) => d.currency === currency).map((d) => ({ contractId: d.contractId, brand: d.brand, contract: r2(d.finalAmount), lines: r2(d.lines.reduce((s, l) => s + l.revenue, 0)) })).filter((x) => Math.abs(x.contract - x.lines) > 0.01)
}

export interface OpenProposal { stage: string; currency: string; value: number; estimated: boolean }
export interface ForecastRow { stage: string; count: number; value: number; weight_pct: number; weighted: number }
/** The pipeline, weighted by how likely each stage is to be won. `estimated` counts proposals with no priced lines yet, valued at their budget. */
export function weightedForecast(proposals: OpenProposal[], weights: Record<string, number>, currency: string): { stages: ForecastRow[]; total: { count: number; value: number; weighted: number; estimated: number } } {
  const stages = OPEN_STAGES.map((stage) => { const mine = proposals.filter((p) => p.stage === stage && p.currency === currency); const value = mine.reduce((s, p) => s + p.value, 0); const w = weights[stage] ?? DEFAULT_WEIGHTS[stage] ?? 0
    return { stage, count: mine.length, value: r2(value), weight_pct: w, weighted: r2(value * (w / 100)) } })
  return { stages, total: { count: stages.reduce((s, x) => s + x.count, 0), value: r2(stages.reduce((s, x) => s + x.value, 0)), weighted: r2(stages.reduce((s, x) => s + x.weighted, 0)), estimated: proposals.filter((p) => p.currency === currency && p.estimated && (OPEN_STAGES as readonly string[]).includes(p.stage)).length } }
}

export interface PlanRow { period: string; booked_target: number; collected_target: number | null }
export interface VarianceRow extends MonthRow { plan_booked: number | null; booked_variance: number | null; booked_pct: number | null; plan_collected: number | null; collected_variance: number | null }
/** Actual against plan, month by month. A month with no plan shows no variance (not "100% over"). */
export function variance(months: MonthRow[], plan: PlanRow[]): VarianceRow[] {
  const by = new Map(plan.map((p) => [p.period, p]))
  return months.map((m) => { const p = by.get(m.month)
    return { ...m, plan_booked: p ? p.booked_target : null, booked_variance: p ? r2(m.booked - p.booked_target) : null, booked_pct: p && p.booked_target > 0 ? r1((m.booked / p.booked_target) * 100) : null,
      plan_collected: p && p.collected_target != null ? p.collected_target : null, collected_variance: p && p.collected_target != null ? r2(m.collected - p.collected_target) : null } })
}
