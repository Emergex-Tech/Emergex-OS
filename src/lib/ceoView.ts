import { supabaseService } from './supabaseServer'
import { buildPipeline } from './pipeline'

export interface SignoffLine {
  line_id: string; proposal_id: string; brand_name: string; item_name: string
  margin_pct: number; sell_price: number; currency: string; pricing_mechanic: string
  set_by_layer: 'manager' | 'ceo'; last_action_at: string
}

/**
 * A32: a line needs CEO sign-off when the MOST RECENT pricing action taken on it was a Manager's
 * (margin_set), not a CEO's (confirmed/overridden) — i.e. nobody at CEO level has looked at it
 * since it was last touched. Scoped to Approved-or-later stages: a Draft's pricing isn't "ready"
 * for sign-off yet, it's still being built.
 */
async function buildSignoffQueue(orgId: string): Promise<SignoffLine[]> {
  const svc = supabaseService()
  const { data: proposals } = await svc.from('proposals').select('id, currency, brands(name)').eq('org_id', orgId).in('stage', ['Approved', 'Sent', 'Negotiating'])
  if (!proposals || proposals.length === 0) return []

  const { data: lines } = await svc.from('proposal_lines').select('id, proposal_id, pricing_mechanic, items(name)').in('proposal_id', proposals.map((p) => p.id))
  if (!lines || lines.length === 0) return []

  const { data: approvals } = await svc
    .from('proposal_approvals').select('proposal_line_id, layer, action, created_at')
    .in('proposal_line_id', lines.map((l) => l.id)).in('layer', ['manager', 'ceo'])
    .order('created_at', { ascending: false })

  const latestByLine = new Map<string, { layer: string; created_at: string }>()
  for (const a of approvals ?? []) if (!latestByLine.has(a.proposal_line_id)) latestByLine.set(a.proposal_line_id, a)

  const pendingLineIds = lines.filter((l) => latestByLine.get(l.id)?.layer === 'manager').map((l) => l.id)
  if (pendingLineIds.length === 0) return []

  const { data: pricing } = await svc.from('proposal_line_pricing').select('proposal_line_id, margin_pct, net_margin_pct').in('proposal_line_id', pendingLineIds)
  const pricingByLine = Object.fromEntries((pricing ?? []).map((p) => [p.proposal_line_id, p]))
  const { data: lineSellPrices } = await svc.from('proposal_lines').select('id, sell_price').in('id', pendingLineIds)
  const sellByLine = Object.fromEntries((lineSellPrices ?? []).map((l) => [l.id, l.sell_price]))
  const proposalById = Object.fromEntries(proposals.map((p) => [p.id, p]))

  return lines.filter((l) => pendingLineIds.includes(l.id)).map((l) => {
    const proposal = proposalById[l.proposal_id]
    const latest = latestByLine.get(l.id)!
    return {
      line_id: l.id, proposal_id: l.proposal_id,
      brand_name: (proposal.brands as unknown as { name: string } | null)?.name ?? '',
      item_name: (l.items as unknown as { name: string } | null)?.name ?? '',
      margin_pct: Number(pricingByLine[l.id]?.margin_pct ?? 0),
      sell_price: Number(sellByLine[l.id] ?? 0), currency: proposal.currency, pricing_mechanic: l.pricing_mechanic,
      set_by_layer: latest.layer as 'manager' | 'ceo', last_action_at: latest.created_at
    }
  })
}

export interface CeoViewSummary {
  inventory: { total_value: number; expiring_14d: number; edge_count: number; stale_count: number }
  pipeline_by_stage: { stage: string; count: number; value: number }[]
  brands_agents: { route_count_by_type: Record<string, number>; conflicts_pending: number; conflicts_overridden: number }
  pricing: { signoff_queue: SignoffLine[]; recent_vendor_rate_changes: { item_name: string; type: string; amount: number; currency: string; price_date: string }[] }
  team: { recent_activity: { at: string; actor: string | null; action: string; entity_type: string }[]; pending_route_scores: number; pending_overrides: number; pending_share_overrides: number }
}

export async function buildCeoViewSummary(orgId: string): Promise<CeoViewSummary> {
  const svc = supabaseService()
  const soon = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()

  const [expiring, edges, staleProps, staleItems, routes, conflictsPending, conflictsOverridden,
    pipeline, recentPrices, activity, pendingScores, pendingOverrides, pendingShareOverrides] = await Promise.all([
    svc.from('items').select('id', { count: 'exact', head: true }).lte('offer_expiry', soon).gte('offer_expiry', new Date().toISOString().slice(0, 10)),
    svc.from('property_edge').select('property_id', { count: 'exact', head: true }).eq('is_edge', true),
    svc.from('properties').select('id', { count: 'exact', head: true }).eq('is_stale', true),
    svc.from('items').select('id', { count: 'exact', head: true }).eq('is_stale', true),
    svc.from('routes').select('route_type').eq('org_id', orgId),
    svc.from('share_conflict_overrides').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'pending'),
    svc.from('share_conflict_overrides').select('id', { count: 'exact', head: true }).eq('org_id', orgId).in('status', ['approved', 'used']),
    buildPipeline(orgId, true),
    svc.from('price_records').select('amount, currency, type, price_date, items(name)').in('type', ['rack', 'quote']).gte('created_at', weekAgo).order('created_at', { ascending: false }).limit(10),
    svc.from('audit_events').select('created_at, action, entity_type, profiles(full_name)').eq('org_id', orgId).order('created_at', { ascending: false }).limit(20),
    svc.from('route_score_changes').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'pending'),
    svc.from('reconfirmation_overrides').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'pending'),
    svc.from('share_conflict_overrides').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'pending')
  ])

  // Inventory value: sum of the most recent non-market-intel price per item (a lightweight stand-in
  // for bestValidCost() across the whole catalog — that function is per-item and would mean one
  // query per item here; this is the same "most recent real price" idea applied in bulk).
  const { data: allPrices } = await svc.from('price_records').select('item_id, amount, price_date, type').neq('type', 'market_intel').order('price_date', { ascending: false })
  const latestByItem = new Map<string, number>()
  for (const p of allPrices ?? []) if (!latestByItem.has(p.item_id) && p.amount != null) latestByItem.set(p.item_id, Number(p.amount))
  const totalValue = Array.from(latestByItem.values()).reduce((s, v) => s + v, 0)

  const routeCountByType: Record<string, number> = {}
  for (const r of routes.data ?? []) routeCountByType[r.route_type] = (routeCountByType[r.route_type] ?? 0) + 1

  const pipelineByStage = new Map<string, { count: number; value: number }>()
  for (const p of pipeline) {
    const row = pipelineByStage.get(p.stage) ?? { count: 0, value: 0 }
    row.count++; row.value += p.value
    pipelineByStage.set(p.stage, row)
  }

  return {
    inventory: { total_value: totalValue, expiring_14d: expiring.count ?? 0, edge_count: edges.count ?? 0, stale_count: (staleProps.count ?? 0) + (staleItems.count ?? 0) },
    pipeline_by_stage: Array.from(pipelineByStage.entries()).map(([stage, v]) => ({ stage, ...v })),
    brands_agents: { route_count_by_type: routeCountByType, conflicts_pending: conflictsPending.count ?? 0, conflicts_overridden: conflictsOverridden.count ?? 0 },
    pricing: {
      signoff_queue: await buildSignoffQueue(orgId),
      recent_vendor_rate_changes: (recentPrices.data ?? []).map((r) => ({ item_name: (r.items as unknown as { name: string } | null)?.name ?? '', type: r.type, amount: Number(r.amount), currency: r.currency, price_date: r.price_date }))
    },
    team: {
      recent_activity: (activity.data ?? []).map((a) => ({ at: a.created_at, actor: (a.profiles as unknown as { full_name: string } | null)?.full_name ?? null, action: a.action, entity_type: a.entity_type })),
      pending_route_scores: pendingScores.count ?? 0, pending_overrides: pendingOverrides.count ?? 0, pending_share_overrides: pendingShareOverrides.count ?? 0
    }
  }
}
