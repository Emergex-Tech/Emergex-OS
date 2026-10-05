// Run with: npx tsx tests/benchmarks.test.ts   (no database or network needed)
import assert from 'node:assert/strict'
import { quantile, medianOf, confidence, suggestSell, effectiveDays, bucketCurve, parseCriteria } from '../src/lib/benchmarks'
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name) }

console.log('statistics')
test('quantiles match Postgres percentile_cont exactly (these are the same numbers the SQL test asserts)', () => {
  const xs = [10000, 20000, 30000, 40000]
  assert.equal(quantile(xs, 0.25), 17500); assert.equal(quantile(xs, 0.5), 25000); assert.equal(quantile(xs, 0.75), 32500)
  assert.equal(quantile(xs, 0), 10000); assert.equal(quantile(xs, 1), 40000)
})
test('median of odd and even sets, unsorted input untouched', () => { const a = [5, 1, 3]; assert.equal(medianOf(a), 3); assert.deepEqual(a, [5, 1, 3]); assert.equal(medianOf([1, 2, 3, 4]), 2.5); assert.equal(medianOf([7]), 7) })
test('a single value gives that value at every quantile; empty gives NaN', () => { assert.equal(quantile([9], 0.25), 9); assert.ok(Number.isNaN(quantile([], 0.5))) })
test('confidence: under 3 prices there is no range worth showing', () => {
  assert.deepEqual([0, 1, 2, 3, 9, 10, 29, 30, 500].map(confidence), ['insufficient', 'insufficient', 'insufficient', 'low', 'low', 'moderate', 'moderate', 'good', 'good'])
})

console.log('suggested sell range (B20)')
test('applies the tier band to the quartiles, rounded to cents', () => {
  assert.deepEqual(suggestSell({ p25: 17500, median: 25000, p75: 32500 }, { low: 18, high: 24 }), { low: 20650, mid: 30250, high: 40300 })
  assert.deepEqual(suggestSell({ p25: 100.005, median: 100, p75: 100 }, { low: 10, high: 10 }).low, 110.01)
})
test('a zero band returns the cost range unchanged; a bad band is refused, not silently used', () => {
  assert.deepEqual(suggestSell({ p25: 1, median: 2, p75: 3 }, { low: 0, high: 0 }), { low: 1, mid: 2, high: 3 })
  for (const band of [{ low: -1, high: 5 }, { low: 10, high: 5 }, { low: 0, high: 501 }, { low: NaN, high: 5 }]) assert.throws(() => suggestSell({ p25: 1, median: 2, p75: 3 }, band), /not valid/)
})

console.log('price curve (B19)')
test('effective days: recorded value wins, else derived from the event date, else unknown (never guessed)', () => {
  assert.equal(effectiveDays(90, '2026-12-31', '2026-01-01'), 90); assert.equal(effectiveDays(null, '2026-02-01', '2026-01-01'), 31); assert.equal(effectiveDays(null, null, '2026-01-01'), null)
  assert.equal(effectiveDays(0, '2026-12-31', '2026-01-01'), 0, 'a recorded 0 is a real value, not "missing"'); assert.equal(effectiveDays(null, '2026-01-01', '2026-02-01'), -31)
})
test('bucket edges are inclusive and every day belongs to exactly one bucket', () => {
  const pts = [0, 7, 8, 30, 31, 60, 61, 90, 91, 180, 181, 400].map((d) => ({ days: d, amount: 100 }))
  const { buckets } = bucketCurve(pts); assert.deepEqual(buckets.map((b) => [b.label, b.n]), [['0–7 days', 2], ['8–30 days', 2], ['31–60 days', 2], ['61–90 days', 2], ['91–180 days', 2], ['181+ days', 2]])
  assert.equal(buckets.reduce((s, b) => s + b.n, 0), pts.length)
})
test('per-bucket median/min/max, and prices recorded after the event are excluded and counted', () => {
  const r = bucketCurve([{ days: 100, amount: 50 }, { days: 120, amount: 70 }, { days: 150, amount: 90 }, { days: 5, amount: 20 }, { days: -3, amount: 999 }])
  assert.deepEqual(r.buckets, [{ label: '0–7 days', n: 1, median: 20, min: 20, max: 20 }, { label: '91–180 days', n: 3, median: 70, min: 50, max: 90 }]); assert.equal(r.excludedAfterEvent, 1)
  assert.deepEqual(bucketCurve([]), { buckets: [], excludedAfterEvent: 0 })
})

console.log('filter criteria (B22)')
test('accepts the whitelisted filters and drops empty ones', () => {
  const r = parseCriteria({ category_key: 'ooh_led', market: ' UAE ', availability: 'available', q: ' led ', stale_only: 'true', vendor_id: '11111111-1111-1111-1111-111111111111', market2: '', x: undefined })
  assert.deepEqual(r, { ok: true, criteria: { category_key: 'ooh_led', market: 'UAE', availability: 'available', q: 'led', stale_only: true, vendor_id: '11111111-1111-1111-1111-111111111111' } })
  assert.deepEqual(parseCriteria({}), { ok: true, criteria: {} })
})
test('REFUSES unknown keys and bad values — nothing arbitrary can be stored', () => {
  for (const bad of [{ evil: 1 }, { '__proto__': 'x', admin: true }, { category_key: 'a b' }, { category_key: 'x'.repeat(61) }, { vendor_id: 'nope' }, { availability: 'maybe' }, { q: 'x'.repeat(81) }, { market: 'x'.repeat(61) }, { category_key: { $ne: 1 } }])
    assert.equal(parseCriteria(bad as Record<string, unknown>).ok, false, JSON.stringify(bad).slice(0, 50))
})
test('stale_only is only true for true/"true"/"1"', () => { for (const [v, want] of [[true, true], ['true', true], ['1', true], ['false', false], ['yes', false], [0, false]] as const) assert.equal((parseCriteria({ stale_only: v }) as { criteria: { stale_only: boolean } }).criteria.stale_only, want) })
console.log(`\n${passed} passed`)
