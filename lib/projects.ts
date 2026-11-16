// Pure project logic (L1, L3, L5, L6, L29) — no database.

// D14: the PRD assigns every category to a template (6.18).
export const FULL_CATEGORIES = ['league_tournament', 'team', 'player_athlete', 'celebrity_talent', 'ip_shows', 'events_activations'] as const
export const SHORT_CATEGORIES = ['influencer_creator', 'ooh_led', 'digital_publisher_app', 'broadcast_streaming', 'transit_vehicle', 'content_production'] as const

/**
 * A deal can span categories. If ANY line is a Full-template category the project gets the Full checklist (a superset:
 * too many steps is safer than a missing one). A deal with no recognisable category also gets Full, for the same reason.
 */
export function templateForCategories(keys: (string | null | undefined)[]): 'full' | 'short' {
  const known = keys.filter((k): k is string => !!k)
  if (known.length === 0) return 'full'
  if (known.some((k) => (FULL_CATEGORIES as readonly string[]).includes(k))) return 'full'
  return known.every((k) => (SHORT_CATEGORIES as readonly string[]).includes(k)) ? 'short' : 'full'
}

export type GateRule = 'contract_exists' | 'contract_file_uploaded' | 'billing_schedule_created' | 'first_invoice_issued' | 'first_invoice_paid' | 'all_invoices_paid'
export const GATE_RULES: readonly GateRule[] = ['contract_exists', 'contract_file_uploaded', 'billing_schedule_created', 'first_invoice_issued', 'first_invoice_paid', 'all_invoices_paid']

/** What the contract and invoice records say. Only COUNTS and booleans — never amounts, so a checklist can't leak finance data. */
export interface ProjectFacts { contractExists: boolean; contractFileUploaded: boolean; receivables: { total: number; issued: number; paid: number } }

/** L6: paperwork items tick themselves from the records. "total" excludes void invoices; "paid" means fully paid. */
export function ruleSatisfied(rule: GateRule | null, f: ProjectFacts): boolean {
  switch (rule) {
    case 'contract_exists': return f.contractExists
    case 'contract_file_uploaded': return f.contractFileUploaded
    case 'billing_schedule_created': return f.receivables.total >= 1
    case 'first_invoice_issued': return f.receivables.issued >= 1
    case 'first_invoice_paid': return f.receivables.paid >= 1
    case 'all_invoices_paid': return f.receivables.total >= 1 && f.receivables.paid === f.receivables.total
    default: return false
  }
}

export type ItemStatus = 'open' | 'done' | 'na'
/** A ticked box wins; otherwise a satisfied rule ticks it. If the facts later change (an invoice is voided) it correctly reopens. N/A is never overridden. */
export function effectiveStatus(item: { status: ItemStatus; auto_rule: GateRule | null }, f: ProjectFacts): ItemStatus {
  if (item.status === 'na') return 'na'
  return item.status === 'done' || ruleSatisfied(item.auto_rule, f) ? 'done' : 'open'
}

interface PhaseItem { phase_no: number; phase_name: string; side: 'brand' | 'team'; status: ItemStatus }
export interface SideProgress { total: number; done: number; na: number }
export interface PhaseProgress { phase_no: number; phase_name: string; total: number; done: number; na: number; pct: number; brand: SideProgress; team: SideProgress }

/** pct = done ÷ (items that aren't N/A). A phase where everything is N/A counts as complete. */
export function phaseProgress(items: PhaseItem[]): PhaseProgress[] {
  const phases = new Map<number, PhaseProgress>()
  for (const i of items) {
    const p = phases.get(i.phase_no) ?? { phase_no: i.phase_no, phase_name: i.phase_name, total: 0, done: 0, na: 0, pct: 0, brand: { total: 0, done: 0, na: 0 }, team: { total: 0, done: 0, na: 0 } }
    for (const t of [p, p[i.side]]) { t.total++; if (i.status === 'done') t.done++; if (i.status === 'na') t.na++ }
    phases.set(i.phase_no, p)
  }
  return Array.from(phases.values()).sort((a, b) => a.phase_no - b.phase_no).map((p) => ({ ...p, pct: p.total - p.na === 0 ? 100 : Math.round((p.done / (p.total - p.na)) * 100) }))
}

export type GateState = 'cleared' | 'open' | 'none'
/** The commercial gate = phase 1, tracked separately for the brand side and the team side. 'none' = that side has no items to clear. */
export function gateStatus(p1: PhaseProgress | undefined): { brand: GateState; team: GateState; overall: 'cleared' | 'open' } {
  const side = (s: SideProgress | undefined): GateState => (!s || s.total - s.na === 0 ? 'none' : s.done >= s.total - s.na ? 'cleared' : 'open')
  const brand = side(p1?.brand), team = side(p1?.team)
  return { brand, team, overall: brand !== 'open' && team !== 'open' ? 'cleared' : 'open' }
}

export interface CommLite { id: string; status: string; waiting_on: string | null; party_id: string | null; occurred_at: string; kind: string }
export interface OpenRequests { total: number; onUs: number; onThem: number; oldestDays: number | null; byParty: Record<string, { onUs: number; onThem: number }> }
/** "Open requests show who is waiting on whom." */
export function summariseOpenRequests(comms: CommLite[], nowMs = Date.now()): OpenRequests {
  const open = comms.filter((c) => c.status === 'open' && c.kind === 'request')
  const byParty: OpenRequests['byParty'] = {}
  for (const c of open) { const k = c.party_id ?? '(no party)'; byParty[k] ??= { onUs: 0, onThem: 0 }; if (c.waiting_on === 'us') byParty[k].onUs++; else byParty[k].onThem++ }
  const ages = open.map((c) => Math.floor((nowMs - Date.parse(c.occurred_at)) / 86_400_000))
  return { total: open.length, onUs: open.filter((c) => c.waiting_on === 'us').length, onThem: open.filter((c) => c.waiting_on === 'them').length, oldestDays: ages.length ? Math.max(...ages) : null, byParty }
}
/** A request's owner of the next move: one WE sent is waiting on THEM; one we RECEIVED is waiting on US. */
export const waitingOn = (direction: 'inbound' | 'outbound'): 'us' | 'them' => (direction === 'outbound' ? 'them' : 'us')
