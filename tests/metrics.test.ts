// Run with: npx tsx tests/metrics.test.ts   (no database or network needed)
import assert from 'node:assert/strict'
import { latestPerSubject, summariseMetrics, validateMetricValue, parseDriveLink, proofMissing, assessRisk, STALE_REQUEST_DAYS, type MetricDef, type MetricEntry } from '../src/lib/metrics'
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name) }
const e = (d: string | null, k: string, v: number, on: string, created = '2026-01-01T00:00:00Z', voided: string | null = null): MetricEntry => ({ deliverable_id: d, category_key: 'influencer_creator', metric_key: k, value: v, recorded_on: on, created_at: created, voided_at: voided })
const defs: MetricDef[] = [
  { category_key: 'influencer_creator', key: 'views', label: 'Views', unit: null, aggregation: 'sum', position: 10, active: true },
  { category_key: 'influencer_creator', key: 'engagement_rate', label: 'Engagement rate', unit: '%', aggregation: 'avg', position: 20, active: true },
  { category_key: 'influencer_creator', key: 'saves', label: 'Saves', unit: null, aggregation: 'sum', position: 5, active: true }]

console.log('metric entries (L14)')
test('the LATEST reading per deliverable and metric counts — a newer total replaces an older one', () => {
  const l = latestPerSubject([e('A', 'views', 100, '2026-06-01'), e('A', 'views', 250, '2026-06-08'), e('A', 'views', 180, '2026-06-03')])
  assert.equal(l.length, 1); assert.equal(l[0].value, 250)
})
test('same date: the later-created entry wins; a voided entry never counts (even if it is the newest)', () => {
  assert.equal(latestPerSubject([e('A', 'views', 1, '2026-06-01', '2026-06-01T09:00:00Z'), e('A', 'views', 2, '2026-06-01', '2026-06-01T10:00:00Z')])[0].value, 2)
  assert.equal(latestPerSubject([e('A', 'views', 100, '2026-06-01'), e('A', 'views', 999, '2026-06-09', '2026-06-09T00:00:00Z', '2026-06-09T01:00:00Z')])[0].value, 100)
  assert.equal(latestPerSubject([e('A', 'views', 5, '2026-06-01', '2026-06-01T00:00:00Z', '2026-06-02T00:00:00Z')]).length, 0)
})
test('counts are SUMMED across deliverables, rates AVERAGED; project-wide figures are their own subject', () => {
  const s = summariseMetrics([e('A', 'views', 100, '2026-06-01'), e('B', 'views', 50, '2026-06-02'), e(null, 'views', 10, '2026-06-03'), e('A', 'engagement_rate', 4, '2026-06-01'), e('B', 'engagement_rate', 6, '2026-06-02')], defs)
  const v = s.find((x) => x.metric_key === 'views')!, r = s.find((x) => x.metric_key === 'engagement_rate')!
  assert.deepEqual([v.value, v.subjects, v.as_of], [160, 3, '2026-06-03']); assert.deepEqual([r.value, r.subjects], [5, 2])
})
test('only metrics with data appear, in the definition order; replaced readings do not double-count', () => {
  const s = summariseMetrics([e('A', 'views', 100, '2026-06-01'), e('A', 'saves', 7, '2026-06-01'), e('A', 'views', 140, '2026-06-05')], defs)
  assert.deepEqual(s.map((x) => x.metric_key), ['saves', 'views']); assert.equal(s[1].value, 140, '140, not 240')
  assert.deepEqual(summariseMetrics([], defs), [])
})
test('the same metric key in two categories stays separate', () => {
  const two: MetricDef[] = [...defs, { category_key: 'ooh_led', key: 'views', label: 'Views', unit: null, aggregation: 'sum', position: 1, active: true }]
  const s = summariseMetrics([e('A', 'views', 10, '2026-06-01'), { ...e('A', 'views', 99, '2026-06-01'), category_key: 'ooh_led' }], two)
  assert.deepEqual(s.map((x) => [x.category_key, x.value]).sort(), [['influencer_creator', 10], ['ooh_led', 99]])
})
test('value validation: numbers only, never negative, percentages capped at 100', () => {
  assert.deepEqual(validateMetricValue({ unit: null }, '1200'), { ok: true, value: 1200 }); assert.deepEqual(validateMetricValue({ unit: '%' }, 100), { ok: true, value: 100 })
  for (const [u, v] of [[null, -1], [null, 'abc'], [null, ''], [null, null], [null, NaN], [null, Infinity], [null, 1e13], ['%', 100.1], [null, {}]] as const) assert.equal(validateMetricValue({ unit: u }, v).ok, false, String(v))
})

console.log('proof links (L11)')
test('accepts ordinary Drive and Docs links and pulls out the file id', () => {
  const a = parseDriveLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing#x'); assert.deepEqual([a.ok, (a as { fileId: string }).fileId], [true, '1AbCdEfGhIjKlMnOp']); assert.ok(!(a as { url: string }).url.includes('#'))
  assert.equal((parseDriveLink('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp') as { fileId: string }).fileId, '1AbCdEfGhIjKlMnOp'); assert.equal(parseDriveLink('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit').ok, true)
  assert.equal((parseDriveLink('https://drive.google.com/drive/folders/short') as { fileId: string | null }).fileId, null, 'no recognisable id is allowed, just not extracted')
})
test('refuses anything that is not a plain https Google link — including look-alikes, credentials and script URLs', () => {
  for (const bad of ['http://drive.google.com/file/d/1AbCdEfGhIjKlMnOp', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://drive.google.com/x', 'https://evil.example/drive.google.com/file/d/1AbCdEfGhIjKlMnOp', 'https://drive.google.com.evil.example/file/d/1AbCdEfGhIjKlMnOp', 'https://evildrive.google.com/x', 'https://google.com/x', 'https://user:pw@drive.google.com/file/d/1AbCdEfGhIjKlMnOp', 'https://drive.google.com/file d/x', 'drive.google.com/file/d/1AbCdEfGhIjKlMnOp', '', '   ', 'https://drive.google.com/' + 'a'.repeat(600)])
    assert.equal(parseDriveLink(bad).ok, false, bad.slice(0, 50))
  for (const nonString of [null, undefined, 5, {}]) assert.equal(parseDriveLink(nonString).ok, false)
})
test('proof is "missing" only when something was delivered and nothing is on file', () => {
  assert.equal(proofMissing({ status: 'delivered', delivered_quantity: 4 }, 0), true); assert.equal(proofMissing({ status: 'partial', delivered_quantity: 1 }, 0), true); assert.equal(proofMissing({ status: 'delivered', delivered_quantity: 4 }, 1), false)
  for (const st of ['planned', 'missed', 'replaced']) assert.equal(proofMissing({ status: st, delivered_quantity: 0 }, 0), false, st)
})

console.log('delivery at risk (L26)')
test('every reason is listed with its count; nothing wrong means not at risk', () => {
  assert.deepEqual(assessRisk({ overdueDeliverables: 0, missedUnresolved: 0, oldestWaitingOnUsDays: null, overdueSteps: 0 }), { atRisk: false, reasons: [] })
  const r = assessRisk({ overdueDeliverables: 2, missedUnresolved: 1, oldestWaitingOnUsDays: STALE_REQUEST_DAYS + 1, overdueSteps: 3 })
  assert.equal(r.atRisk, true); assert.deepEqual(r.reasons.map((x) => x.code), ['overdue_deliverables', 'missed_unresolved', 'stale_request', 'overdue_steps']); assert.match(r.reasons[0].detail, /2 deliverables are past due/)
})
test('a request is only "stale" after 5 days, a single item reads in the singular', () => {
  assert.equal(assessRisk({ overdueDeliverables: 0, missedUnresolved: 0, oldestWaitingOnUsDays: STALE_REQUEST_DAYS, overdueSteps: 0 }).atRisk, false, 'exactly 5 days is not yet stale')
  assert.equal(assessRisk({ overdueDeliverables: 0, missedUnresolved: 0, oldestWaitingOnUsDays: 6, overdueSteps: 0 }).atRisk, true)
  assert.match(assessRisk({ overdueDeliverables: 1, missedUnresolved: 1, oldestWaitingOnUsDays: null, overdueSteps: 1 }).reasons.map((x) => x.detail).join('|'), /1 deliverable is past due.*1 missed deliverable with.*1 checklist step is overdue/)
})
console.log(`\n${passed} passed`)
