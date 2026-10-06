import { daysBetween } from './billing'

// Pure logic for B18–B20 and B22 — no database — so every rule is directly testable.
// EVERYTHING here is advisory: nothing in this file changes a price or a proposal.

/** Linear-interpolation quantile — the same method as Postgres percentile_cont, so TypeScript and SQL agree exactly. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}
export const medianOf = (xs: number[]): number => quantile([...xs].sort((a, b) => a - b), 0.5)
const cents = (n: number) => Math.round(n * 100) / 100

export type Confidence = 'insufficient' | 'low' | 'moderate' | 'good'
/** How much weight a range deserves. Under 3 prices there IS no range worth showing, so it says so rather than inventing one. */
export function confidence(n: number): Confidence { return n < 3 ? 'insufficient' : n < 10 ? 'low' : n < 30 ? 'moderate' : 'good' }

/**
 * B20: turn a typical COST range into a suggested brand-facing range using the brand tier's margin band.
 * Assumes the markup mechanic (cost + margin%) and excludes agent cuts — it's a starting point, not a quote.
 * Low end = lower quartile + the tier's LOW margin; high end = upper quartile + the tier's HIGH margin.
 */
export function suggestSell(stats: { p25: number; median: number; p75: number }, band: { low: number; high: number }) {
  if (![band.low, band.high].every(Number.isFinite) || band.low < 0 || band.high < band.low || band.high > 500) throw new Error('The brand tier margin band is not valid')
  return {
    low: cents(stats.p25 * (1 + band.low / 100)),
    mid: cents(stats.median * (1 + (band.low + band.high) / 2 / 100)),
    high: cents(stats.p75 * (1 + band.high / 100))
  }
}

/** Days before the event this price applied: the recorded value, else event start minus the price date, else unknown (never guessed). */
export function effectiveDays(daysToEvent: number | null, eventStart: string | null, priceDate: string): number | null {
  if (daysToEvent != null) return daysToEvent
  return eventStart ? daysBetween(priceDate, eventStart) : null
}

export const CURVE_BUCKETS = [
  { label: '0–7 days', min: 0, max: 7 }, { label: '8–30 days', min: 8, max: 30 }, { label: '31–60 days', min: 31, max: 60 },
  { label: '61–90 days', min: 61, max: 90 }, { label: '91–180 days', min: 91, max: 180 }, { label: '181+ days', min: 181, max: Infinity }
]
export interface CurvePoint { days: number; amount: number }
export interface CurveBucket { label: string; n: number; median: number; min: number; max: number }

/** B19: median price by how far out from the event it was recorded. Prices recorded AFTER the event started (negative days) are excluded and counted. */
export function bucketCurve(points: CurvePoint[]): { buckets: CurveBucket[]; excludedAfterEvent: number } {
  const buckets: CurveBucket[] = []
  for (const b of CURVE_BUCKETS) {
    const inB = points.filter((p) => p.days >= b.min && p.days <= b.max).map((p) => p.amount)
    if (inB.length) buckets.push({ label: b.label, n: inB.length, median: cents(medianOf(inB)), min: Math.min(...inB), max: Math.max(...inB) })
  }
  return { buckets, excludedAfterEvent: points.filter((p) => p.days < 0).length }
}

// ---------- B22: filter criteria — whitelisted, never an arbitrary blob stored from a request ----------
export const AVAILABILITY = ['available', 'on_hold', 'proposed', 'sold', 'expired'] as const
export interface Criteria { category_key?: string; market?: string; vendor_id?: string; availability?: string; q?: string; stale_only?: boolean }
export type CriteriaResult = { ok: true; criteria: Criteria } | { ok: false; error: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseCriteria(raw: Record<string, unknown>): CriteriaResult {
  const out: Criteria = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null || v === '') continue
    switch (k) {
      case 'category_key': if (typeof v !== 'string' || !/^[a-z0-9_]{1,60}$/.test(v)) return { ok: false, error: 'category_key is not valid' }; out.category_key = v; break
      case 'market': if (typeof v !== 'string' || v.length > 60) return { ok: false, error: 'market is too long' }; out.market = v.trim(); break
      case 'vendor_id': if (typeof v !== 'string' || !UUID.test(v)) return { ok: false, error: 'vendor_id is not valid' }; out.vendor_id = v; break
      case 'availability': if (typeof v !== 'string' || !(AVAILABILITY as readonly string[]).includes(v)) return { ok: false, error: `availability must be one of ${AVAILABILITY.join(', ')}` }; out.availability = v; break
      case 'q': if (typeof v !== 'string' || v.length > 80) return { ok: false, error: 'the search text can be at most 80 characters' }; out.q = v.trim(); break
      case 'stale_only': out.stale_only = v === true || v === 'true' || v === '1'; break
      default: return { ok: false, error: `Unknown filter: ${k}` }
    }
  }
  return { ok: true, criteria: out }
}
