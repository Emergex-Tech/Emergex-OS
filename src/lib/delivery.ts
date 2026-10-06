// Pure delivery-tracking logic (L8–L10) — no database, so every rule is directly testable.

export type DeliveryStatus = 'planned' | 'delivered' | 'partial' | 'missed' | 'replaced'
const r1 = (n: number) => Math.round(n * 10) / 10

/** Delivery % of ONE deliverable, capped at 100 (over-delivery doesn't earn more than 100%). */
export function deliveryPct(planned: number, delivered: number): number {
  if (!(planned > 0) || !(delivered > 0)) return 0
  return r1(Math.min(delivered / planned, 1) * 100)
}

/**
 * The status a recorded delivered-quantity implies. This is what keeps status and quantity from contradicting each other
 * (the database enforces the same rule as a CHECK constraint). A MISSED deliverable that is later delivered late moves to
 * partial/delivered; a REPLACED one is closed — its make-good carries the delivery now, so a quantity can't be recorded on it.
 */
export function statusForQuantity(planned: number, delivered: number, current: DeliveryStatus): DeliveryStatus {
  if (current === 'replaced') throw new Error('This deliverable has been replaced by a make-good; record the delivery against the make-good instead')
  if (!(planned > 0)) throw new Error('The planned quantity must be greater than zero')
  if (!(delivered >= 0)) throw new Error('The delivered quantity cannot be negative')
  if (delivered >= planned) return 'delivered'
  if (delivered > 0) return 'partial'
  return current === 'missed' ? 'missed' : 'planned'
}

export interface DeliveryItem { status: DeliveryStatus; planned: number; delivered: number }
export interface DeliverySummary { pct: number | null; counted: number; replacedExcluded: number; planned: number; partial: number; delivered: number; missed: number }

/**
 * Project (or project-plus-upsells) delivery %. D13 — by COUNT or by VALUE — is an open decision in the PRD; deliverables
 * carry no value yet, so this is the by-count default: every deliverable weighs the same.
 * A REPLACED deliverable is left out of the average (its make-good is counted instead), otherwise a missed item and the
 * make-good that fixed it would be double-counted. A MISSED one counts what was ACTUALLY delivered of it — usually 0%, but a
 * deliverable that was 2 of 5 delivered and then written off as missed is honestly 40%, not 0.
 */
export function projectDelivery(items: DeliveryItem[]): DeliverySummary {
  const counted = items.filter((i) => i.status !== 'replaced')
  const pct = counted.length === 0 ? null : r1(counted.reduce((s, i) => s + deliveryPct(i.planned, i.delivered), 0) / counted.length)
  const n = (s: DeliveryStatus) => items.filter((i) => i.status === s).length
  return { pct, counted: counted.length, replacedExcluded: n('replaced'), planned: n('planned'), partial: n('partial'), delivered: n('delivered'), missed: n('missed') }
}
