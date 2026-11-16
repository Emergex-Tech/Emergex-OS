import { supabaseService } from './supabaseServer'

export interface Conflict {
  conflict_type: 'same_brand_other_route' | 'agent_other_brand' | 'same_brand_group' | 'competing_brand_same_market'
  share_id: string
  shared_at: string
  other_brand_id: string
  other_brand: string
  other_route_id: string | null
  agent_name: string | null
  market: string | null
  detail: string
}

export const CONFLICT_LABELS: Record<Conflict['conflict_type'], string> = {
  same_brand_other_route: 'Same brand, different route',
  agent_other_brand: "Agent's other brand",
  same_brand_group: 'Same brand group',
  competing_brand_same_market: 'Competing brand, same market'
}

/** PRD 6.10 / A21–A24. The logic lives in the check_share_conflicts() SQL function so it is tested against a real database. */
export async function checkConflicts(p: { orgId: string; itemId: string; brandId: string; routeId: string | null }): Promise<Conflict[]> {
  const svc = supabaseService()
  const { data, error } = await svc.rpc('check_share_conflicts', {
    p_org: p.orgId, p_item: p.itemId, p_brand: p.brandId, p_route: p.routeId
  })
  if (error) throw new Error(`Conflict check failed: ${error.message}`)
  return (data ?? []) as Conflict[]
}

export function summarizeConflicts(conflicts: Conflict[]): string {
  return conflicts.map((c) => c.detail).join('; ')
}

export const uniqueTypes = (conflicts: Conflict[]) => Array.from(new Set(conflicts.map((c) => c.conflict_type)))

type OverrideState = 'none' | 'pending' | 'approved' | 'rejected'

/** An override covers exactly one (item, brand, route) combination and can be used once. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scoped(q: any, p: { orgId: string; itemId: string; brandId: string; routeId: string | null }) {
  let query = q.eq('org_id', p.orgId).eq('item_id', p.itemId).eq('brand_id', p.brandId)
  query = p.routeId ? query.eq('route_id', p.routeId) : query.is('route_id', null)
  return query
}

/** An approved, not-yet-used override for this exact combination, if any. */
export async function findUsableOverride(p: { orgId: string; itemId: string; brandId: string; routeId: string | null }): Promise<{ id: string } | null> {
  const svc = supabaseService()
  const { data } = await scoped(svc.from('share_conflict_overrides').select('id'), p).eq('status', 'approved').limit(1).maybeSingle()
  return data ?? null
}

/** Where the most recent unused override request for this combination stands. */
export async function overrideState(p: { orgId: string; itemId: string; brandId: string; routeId: string | null }): Promise<OverrideState> {
  const svc = supabaseService()
  const { data } = await scoped(svc.from('share_conflict_overrides').select('status'), p)
    .in('status', ['pending', 'approved', 'rejected']).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return (data?.status as OverrideState) ?? 'none'
}
