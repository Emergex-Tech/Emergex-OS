export type RoleKey = 'team' | 'management' | 'manager' | 'ceo' // 'management' is legacy — see migrations/002_stage2a_role_split.sql. Stage 2B adds 'agent', Stage 4 adds 'brand'

export interface Profile {
  id: string
  org_id: string
  full_name: string | null
  role_key: RoleKey
}

export interface Category {
  key: string
  label: string
  group_label: string | null
  reconfirmation_rule: 'sponsorship' | '60day' | '90day'
  property_label: string | null
  item_label: string | null
  property_fields: FieldSchema[]
  item_fields: FieldSchema[]
  price_unit_options: string[]
}

export interface FieldSchema {
  key: string
  type: 'text' | 'number' | 'select' | 'boolean' | 'date_range'
  required?: boolean
  options?: string[]
}

export interface Vendor {
  id: string
  org_id: string
  name: string
  type: string | null
  markets: string | null
  status: 'Recurring' | 'Opportunistic' | string
  owner_id: string | null
}

export interface Property {
  id: string
  org_id: string
  category_key: string
  vendor_id: string | null
  name: string
  market: string | null
  event_start: string | null
  event_end: string | null
  attributes: Record<string, unknown>
  delivery_side_agent_id: string | null
  is_stale: boolean
}

export interface Item {
  id: string
  org_id: string
  property_id: string
  name: string
  attributes: Record<string, unknown>
  availability: 'available' | 'on_hold' | 'proposed' | 'sold' | 'expired'
  offer_expiry: string | null
  is_stale: boolean
}

export interface PriceRecord {
  id: string
  org_id: string
  item_id: string
  type: 'rack' | 'quote' | 'negotiated' | 'transacted' | 'market_intel'
  amount: number | null
  currency: string
  unit: string | null
  price_date: string
  validity_days: number | null
  days_to_event: number | null
  source: string | null
  brand_id: string | null
  route_id: string | null
  reusable: boolean
  proposal_id: string | null // reserved, Stage 2A
  outcome: string | null // reserved, Stage 2A
}

export interface Route {
  id: string
  org_id: string
  brand_id: string
  route_type: 'direct' | 'via_agent' | 'via_sub_agent' | 'via_partner'
  agent_id: string | null
  contact_id: string | null
  contact_type: string | null
  market: string | null
  description: string | null
  strength: number | null
  reliability: number | null
  status: 'active' | 'ended'
}

export interface RouteScoreChange {
  id: string
  org_id: string
  route_id: string
  field: 'strength' | 'reliability'
  old_value: number | null
  new_value: number
  status: 'pending' | 'approved' | 'rejected'
  changed_by: string | null
}

export interface IntelNote {
  id: string
  org_id: string
  linked_type: string | null
  linked_id: string | null
  source: string | null
  reliability: 'confirmed' | 'likely' | 'rumour'
  note: string
  submitted_by_agent_id: string | null
}

export interface Share {
  id: string
  org_id: string
  item_id: string
  brand_id: string
  route_id: string | null
  channel: string | null
  logged_after_the_fact: boolean
}

export interface Capture {
  id: string
  org_id: string
  raw_input: string | null
  ai_output: unknown
  status: 'pending_review' | 'confirmed' | 'discarded'
  created_record_refs: { entity_type: string; entity_id: string }[] | null
}

export interface ReconfirmationOverride {
  id: string
  org_id: string
  entity_type: 'property' | 'item' | 'route'
  entity_id: string
  period_days: number
  reason: string
  direction: 'shorten' | 'lengthen'
  status: 'pending' | 'active' | 'rejected' | 'ended'
  ends_on: string | null
  ends_on_availability_change: boolean
}
