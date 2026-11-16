// What an agent is allowed to see, as ONE pure function so it can be tested without a database.
//
// This is an ALLOW-LIST, never a block-list: a field appears only if it is named here. A block-list
// fails open (a new sensitive field added later would leak by default); an allow-list fails closed.
// The PRD says agents see items "stripped of vendor, cost and margin" and never see "price history,
// route scores, share logs, other parties' records or internal intel" (6.7, 6.16, Appendix B).

/** Free-form category attributes an agent may see. Names that identify the source (vendor_name,
 *  management_contact, fleet_operator, league_name, ...) are deliberately NOT here — the white-label
 *  `display_title` is how management chooses what an agent sees as the name. */
export const AGENT_SAFE_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  'sport', 'season_year', 'event_dates', 'broadcast_reach', 'gaming_brand_acceptance', 'exclusivity', 'markets', 'market',
  'platform', 'follower_count', 'roster_exclusivity', 'monthly_traffic', 'asset_type', 'unit_description', 'quantity',
  'asset_position', 'package_type', 'term_length', 'deliverable_type', 'slot_period', 'location_detail', 'branding_type',
  'vehicle_count', 'ad_product', 'integration_type'
])

export interface GrantRow { id: string; display_title: string | null; indicative_price: number | string | null; price_currency: string | null }
export interface ItemRow {
  name: string; availability: string; offer_expiry: string | null; attributes: Record<string, unknown> | null
  properties: { name: string; market: string | null; event_start: string | null; event_end: string | null; attributes: Record<string, unknown> | null; categories: { label: string } | null } | null
}

/** The exact set of keys an agent's item view contains. A test asserts the output has precisely these. */
export const AGENT_ITEM_VIEW_KEYS = ['id', 'title', 'category', 'market', 'event_start', 'event_end', 'offer_expiry', 'availability', 'details', 'indicative_price'] as const

export interface AgentItemView {
  id: string                 // the GRANT's id — never the internal item id
  title: string
  category: string | null
  market: string | null
  event_start: string | null
  event_end: string | null
  offer_expiry: string | null
  availability: 'Available' | 'Not currently available'
  details: Record<string, string | number | boolean>
  indicative_price: { amount: number; currency: string } | null
}

const MAX_TEXT = 300

/** 'proposed', 'sold' and 'on_hold' all collapse to one label: telling an agent WHICH would reveal that someone else is dealing in it (other parties' records). */
export function agentAvailability(a: string): AgentItemView['availability'] {
  return a === 'available' ? 'Available' : 'Not currently available'
}

export function toAgentItemView(grant: GrantRow, item: ItemRow): AgentItemView {
  const prop = item.properties
  const merged: Record<string, unknown> = { ...(prop?.attributes ?? {}), ...(item.attributes ?? {}) }
  const details: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(merged)) {
    if (!AGENT_SAFE_ATTRIBUTE_KEYS.has(k)) continue
    if (typeof v === 'string') { const t = v.trim(); if (t) details[k] = t.slice(0, MAX_TEXT) }
    else if (typeof v === 'number' || typeof v === 'boolean') details[k] = v
    // objects, arrays and null are dropped: they can carry nested fields this function never vetted.
  }
  const price = grant.indicative_price == null ? null : Number(grant.indicative_price)
  return {
    id: grant.id,
    title: (grant.display_title?.trim() || (prop?.name ? `${prop.name} — ${item.name}` : item.name)).slice(0, MAX_TEXT),
    category: prop?.categories?.label ?? null,
    market: prop?.market ?? null,
    event_start: prop?.event_start ?? null,
    event_end: prop?.event_end ?? null,
    offer_expiry: item.offer_expiry,
    availability: agentAvailability(item.availability),
    details,
    indicative_price: price != null && Number.isFinite(price) ? { amount: price, currency: grant.price_currency ?? 'USD' } : null
  }
}

export interface IntelRow { id: string; note: string; created_at: string; review_status: string; claimed_price: number | string | null; claimed_currency: string | null }
export const AGENT_INTEL_VIEW_KEYS = ['id', 'note', 'submitted_at', 'status', 'claimed_price'] as const
/** An agent sees their own notes and where they stand — NOT the reliability a reviewer gave them, who reviewed, or anyone else's. */
export function toAgentIntelView(r: IntelRow) {
  return {
    id: r.id, note: r.note, submitted_at: r.created_at,
    status: r.review_status === 'pending' ? 'Submitted' : r.review_status === 'rejected' ? 'Declined' : 'Reviewed',
    claimed_price: r.claimed_price == null ? null : { amount: Number(r.claimed_price), currency: r.claimed_currency ?? 'USD' }
  }
}
