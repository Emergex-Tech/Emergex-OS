import type { Category, ReconfirmationOverride } from '@/types/db'

/**
 * PRD 6.5 precedence: item override beats property override beats the
 * category rule. Overrides end on a date or when availability changes
 * (that second part is enforced by the caller when availability flips —
 * see api/items/[id]/route.ts).
 */
export function resolveActiveOverride(
  itemOverride: ReconfirmationOverride | null,
  propertyOverride: ReconfirmationOverride | null
): ReconfirmationOverride | null {
  if (itemOverride && itemOverride.status === 'active') return itemOverride
  if (propertyOverride && propertyOverride.status === 'active') return propertyOverride
  return null
}

/**
 * Computes the next re-confirmation due date given:
 * - the category's rule ('sponsorship' taper | '60day' flat | '90day' flat)
 * - the property/item's event date, if any (sponsorship rule needs it)
 * - the last confirmation date
 * - any active override (which replaces the interval entirely)
 */
export function nextReconfirmationDate(params: {
  category: Category
  lastConfirmedAt: Date
  eventStart: Date | null
  activeOverride: ReconfirmationOverride | null
}): Date {
  const { category, lastConfirmedAt, eventStart, activeOverride } = params

  if (activeOverride) {
    const next = new Date(lastConfirmedAt)
    next.setDate(next.getDate() + activeOverride.period_days)
    return next
  }

  if (category.reconfirmation_rule === '60day') return addDays(lastConfirmedAt, 60)
  if (category.reconfirmation_rule === '90day') return addDays(lastConfirmedAt, 90)

  // 'sponsorship': taper based on days between now and the event.
  if (!eventStart) return addDays(lastConfirmedAt, 30) // "No event date: every 30 days"

  const daysToEvent = Math.ceil((eventStart.getTime() - lastConfirmedAt.getTime()) / 86_400_000)
  if (daysToEvent >= 90) {
    // "No check until 90 days before the event" — the next real check point
    // is when the property crosses into the 30-day window.
    return addDays(eventStart, -90)
  }
  if (daysToEvent >= 30) return addDays(lastConfirmedAt, 30)
  return addDays(lastConfirmedAt, 7)
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/** True if `dueDate` has passed — used to set is_stale on properties/items. */
export function isStale(dueDate: Date, now: Date = new Date()): boolean {
  return dueDate.getTime() < now.getTime()
}
