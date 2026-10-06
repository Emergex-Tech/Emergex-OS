import { supabaseService } from './supabaseServer'

export interface WonLostBucket { key: string; won: number; lost: number; won_value: number; lost_value: number }
export interface WonLostAnalysis {
  by_brand: WonLostBucket[]
  by_agent: WonLostBucket[]
  by_market: WonLostBucket[]
  by_category: WonLostBucket[]
  by_reason: { reason: string; count: number }[]
}

function bump(map: Map<string, WonLostBucket>, key: string, outcome: 'Won' | 'Lost', value: number) {
  const row = map.get(key) ?? { key, won: 0, lost: 0, won_value: 0, lost_value: 0 }
  if (outcome === 'Won') { row.won++; row.won_value += value } else { row.lost++; row.lost_value += value }
  map.set(key, row)
}

/**
 * A28: won/lost analysis by brand, agent, market, category, and reason. A proposal's "value" here
 * is its brand-facing total (D10: this doesn't touch margin, so there's no permission gate — the
 * same visibility rule that lets everyone see the pipeline's `value` column applies here too).
 */
export async function buildWonLostAnalysis(orgId: string): Promise<WonLostAnalysis> {
  const svc = supabaseService()

  const { data: proposals } = await svc
    .from('proposals')
    .select('id, stage, brand_id, route_id, brands(name), routes(market, agent_id, agents(name))')
    .eq('org_id', orgId)
    .in('stage', ['Won', 'Lost'])
  if (!proposals || proposals.length === 0) return { by_brand: [], by_agent: [], by_market: [], by_category: [], by_reason: [] }

  const { data: lines } = await svc
    .from('proposal_lines')
    .select('proposal_id, sell_price, quantity, items(properties(category_key, categories(label)))')
    .in('proposal_id', proposals.map((p) => p.id))

  const valueByProposal = new Map<string, number>()
  const categoryByProposal = new Map<string, Set<string>>() // a proposal can span categories; counted once per category it touches
  for (const l of lines ?? []) {
    valueByProposal.set(l.proposal_id, (valueByProposal.get(l.proposal_id) ?? 0) + Number(l.sell_price) * Number(l.quantity))
    const item = l.items as unknown as { properties: { category_key: string; categories: { label: string } | null } | null } | null
    const label = item?.properties?.categories?.label
    if (label) {
      if (!categoryByProposal.has(l.proposal_id)) categoryByProposal.set(l.proposal_id, new Set())
      categoryByProposal.get(l.proposal_id)!.add(label)
    }
  }

  const { data: lostReasons } = await svc
    .from('proposal_stage_history')
    .select('proposal_id, reason')
    .eq('to_stage', 'Lost')
    .in('proposal_id', proposals.filter((p) => p.stage === 'Lost').map((p) => p.id))
    .order('created_at', { ascending: false })
  const reasonByProposal = new Map<string, string>()
  for (const r of lostReasons ?? []) if (!reasonByProposal.has(r.proposal_id)) reasonByProposal.set(r.proposal_id, r.reason ?? '(no reason given)')

  const byBrand = new Map<string, WonLostBucket>(), byAgent = new Map<string, WonLostBucket>()
  const byMarket = new Map<string, WonLostBucket>(), byCategory = new Map<string, WonLostBucket>()
  const reasonCounts = new Map<string, number>()

  for (const p of proposals) {
    const outcome = p.stage as 'Won' | 'Lost'
    const value = valueByProposal.get(p.id) ?? 0
    const route = p.routes as unknown as { market: string | null; agents: { name: string } | null } | null
    const brandName = (p.brands as unknown as { name: string } | null)?.name ?? '(unknown brand)'

    bump(byBrand, brandName, outcome, value)
    bump(byAgent, route?.agents?.name ?? 'Direct', outcome, value)
    bump(byMarket, route?.market ?? '(market not recorded)', outcome, value)
    for (const cat of categoryByProposal.get(p.id) ?? ['(uncategorised)']) bump(byCategory, cat, outcome, value)

    if (outcome === 'Lost') {
      const reason = reasonByProposal.get(p.id) ?? '(no reason given)'
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1)
    }
  }

  const sortDesc = (m: Map<string, WonLostBucket>) => Array.from(m.values()).sort((a, b) => (b.won_value + b.lost_value) - (a.won_value + a.lost_value))
  return {
    by_brand: sortDesc(byBrand), by_agent: sortDesc(byAgent), by_market: sortDesc(byMarket), by_category: sortDesc(byCategory),
    by_reason: Array.from(reasonCounts.entries()).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
  }
}
