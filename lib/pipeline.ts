import { supabaseService } from './supabaseServer'

export interface PipelineProposal {
  id: string
  stage: string
  brand_name: string
  route_label: string
  currency: string
  value: number
  net_margin_pct: number | null // null when the caller can't see margin (D10)
  updated_at: string
}

/**
 * A27: pipeline by stage, value and net margin. `value` is the brand-facing total (D10: visible
 * to everyone). `net_margin_pct` is only computed when the caller holds margin.view — otherwise
 * it comes back null, same visibility rule as everywhere else proposal pricing shows up.
 */
export async function buildPipeline(orgId: string, canViewMargin: boolean): Promise<PipelineProposal[]> {
  const svc = supabaseService()
  const { data: proposals } = await svc
    .from('proposals')
    .select('id, stage, currency, updated_at, brands(name), routes(route_type, agents(name))')
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false })
  if (!proposals || proposals.length === 0) return []

  const { data: lines } = await svc
    .from('proposal_lines')
    .select('id, proposal_id, sell_price, quantity')
    .in('proposal_id', proposals.map((p) => p.id))

  const valueByProposal = new Map<string, number>()
  for (const l of lines ?? []) {
    valueByProposal.set(l.proposal_id, (valueByProposal.get(l.proposal_id) ?? 0) + Number(l.sell_price) * Number(l.quantity))
  }

  const netMarginByProposal = new Map<string, number>()
  if (canViewMargin && lines && lines.length > 0) {
    const { data: pricing } = await svc.from('proposal_line_pricing').select('proposal_line_id, net_margin_emx').in('proposal_line_id', lines.map((l) => l.id))
    const netByLine = new Map((pricing ?? []).map((p) => [p.proposal_line_id, Number(p.net_margin_emx)]))
    for (const l of lines) {
      const net = netByLine.get(l.id)
      if (net != null) netMarginByProposal.set(l.proposal_id, (netMarginByProposal.get(l.proposal_id) ?? 0) + net)
    }
  }

  return proposals.map((p) => {
    const route = p.routes as unknown as { route_type: string; agents: { name: string } | null } | null
    const value = valueByProposal.get(p.id) ?? 0
    const netMargin = canViewMargin ? netMarginByProposal.get(p.id) ?? 0 : null
    return {
      id: p.id, stage: p.stage, currency: p.currency,
      brand_name: (p.brands as unknown as { name: string } | null)?.name ?? '',
      route_label: route ? (route.agents?.name ? `via ${route.agents.name}` : route.route_type.replace(/_/g, ' ')) : 'Direct',
      value,
      net_margin_pct: netMargin != null && value > 0 ? (netMargin / value) * 100 : netMargin,
      updated_at: p.updated_at
    }
  })
}
