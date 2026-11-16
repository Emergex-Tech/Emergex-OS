import { supabaseService } from './supabaseServer'
import { ApiError } from './auth'
import { isUuid } from './ids'

/**
 * Saved filters and shortlists are personal workspace: you see your own and anything shared with the organisation,
 * but only the OWNER may change or delete one. A private list that isn't yours gets the same 404 as one that doesn't exist.
 */
export async function loadOwned(table: 'saved_filters' | 'shortlists', orgId: string, userId: string, id: string) {
  if (!isUuid(id)) throw new ApiError(404, 'Not found')
  const { data } = await supabaseService().from(table).select('id, owner_id, shared').eq('id', id).eq('org_id', orgId).maybeSingle()
  if (!data || (data.owner_id !== userId && !data.shared)) throw new ApiError(404, 'Not found')
  if (data.owner_id !== userId) throw new ApiError(403, 'Only the person who made this can change it')
  return data
}

export function cleanName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim() : ''
  if (!name) throw new ApiError(400, 'A name is required')
  if (name.length > 80) throw new ApiError(400, 'The name can be at most 80 characters')
  return name
}
export const isUniqueViolation = (e: { code?: string } | null) => e?.code === '23505'

/** `criteria` must be a plain object when supplied. An array or string is a client bug — refuse it rather than save an empty filter. */
export function plainObject(v: unknown): Record<string, unknown> {
  if (v === undefined || v === null) return {}
  if (typeof v !== 'object' || Array.isArray(v)) throw new ApiError(400, 'criteria must be an object')
  return v as Record<string, unknown>
}
