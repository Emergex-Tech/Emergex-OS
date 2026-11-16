import { supabaseService } from './supabaseServer'

// A line counts as "priced at Manager level" once a manager or ceo has acted on
// its pricing: set a margin, confirmed it, overridden it, or applied a renegotiated cost.
const PRICING_ACTIONS = ['margin_set', 'confirmed', 'overridden', 'cost_updated']

/**
 * PRD A13: "Block sending until priced at Manager level." Returns the lines that
 * no manager/ceo has touched yet. Shared by the stage-change endpoint and the
 * export endpoint so the two can never disagree about what "priced" means.
 */
export async function findUnpricedLines(proposalId: string): Promise<{ id: string; name: string }[]> {
  const svc = supabaseService()
  const { data: lines } = await svc.from('proposal_lines').select('id, items(name)').eq('proposal_id', proposalId)
  if (!lines || lines.length === 0) return []

  const { data: approvals } = await svc
    .from('proposal_approvals')
    .select('proposal_line_id')
    .in('proposal_line_id', lines.map((l) => l.id))
    .in('layer', ['manager', 'ceo'])
    .in('action', PRICING_ACTIONS)

  const priced = new Set((approvals ?? []).map((a) => a.proposal_line_id))
  return lines
    .filter((l) => !priced.has(l.id))
    .map((l) => ({ id: l.id, name: (l.items as unknown as { name: string } | null)?.name ?? l.id }))
}
