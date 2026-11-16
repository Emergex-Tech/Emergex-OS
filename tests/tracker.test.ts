// Run with: npx tsx tests/tracker.test.ts   (no database or network needed)
import assert from 'node:assert/strict'
import { statusForQuantity, projectDelivery } from '../src/lib/delivery'
import { parseProofLink, safeProofLink } from '../src/lib/proofLinks'
import { latestPerSubject, summariseMetrics, type MetricDef, type MetricEntry } from '../src/lib/metrics'
import { buildReport, type ReportInput } from '../src/lib/reportBuilder'
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name) }

console.log('waived ("not wanted by the brand")')
test('a waived deliverable is left out of the delivery % — it is neither a delivery nor a failure', () => {
  const s = projectDelivery([{ status: 'delivered', planned: 10, delivered: 10 }, { status: 'partial', planned: 8, delivered: 6 }, { status: 'waived', planned: 1, delivered: 0 }])
  assert.deepEqual([s.pct, s.counted, s.waivedExcluded, s.replacedExcluded], [87.5, 2, 1, 0], '(100 + 75) ÷ 2 — not ÷ 3')
  assert.equal(projectDelivery([{ status: 'waived', planned: 1, delivered: 0 }]).pct, null, 'only waived work = nothing to measure')
})
test('a delivery cannot be recorded on a waived deliverable until it is reinstated', () => {
  assert.throws(() => statusForQuantity(4, 1, 'waived'), /waived by the brand/); assert.equal(statusForQuantity(4, 1, 'planned'), 'partial')
})

console.log('proof links (Drive and public social posts)')
test('accepts Drive/Docs and Instagram, Facebook, X, TikTok and YouTube post links, naming the platform', () => {
  const p = (u: string) => { const r = parseProofLink(u); return r.ok ? r.platform : r.reason }
  assert.deepEqual(['https://www.instagram.com/p/DAbc123/', 'https://instagram.com/reel/xyz/', 'https://www.facebook.com/share/p/1Abc/', 'https://fb.watch/tH8UeSNWB5/', 'https://x.com/sunnyleone/status/123', 'https://twitter.com/a/status/1',
    'https://vt.tiktok.com/ZSYKdB/', 'https://www.tiktok.com/@sunny/video/1', 'https://youtu.be/abc', 'https://www.youtube.com/watch?v=abc', 'https://drive.google.com/drive/folders/15Ep1JDQJW9N5', 'https://docs.google.com/spreadsheets/d/1Ueae/edit'].map(p),
    ['instagram', 'instagram', 'facebook', 'facebook', 'x', 'x', 'tiktok', 'tiktok', 'youtube', 'youtube', 'drive', 'drive'])
  const r = parseProofLink('  https://www.instagram.com/p/abc/#comments  '); assert.ok(r.ok && r.url === 'https://www.instagram.com/p/abc/', 'trimmed, fragment dropped')
})
test('refuses look-alike hosts, other sites, http, credentials, ports and script URLs', () => {
  for (const bad of ['http://www.instagram.com/p/abc/', 'https://instagram.com.evil.example/p/abc/', 'https://evilinstagram.com/p/abc/', 'https://evil.example/www.instagram.com/p/abc/', 'https://www.instagram.com.evil.example', 'https://user:pw@www.instagram.com/p/abc/',
    'https://www.instagram.com:8443/p/abc/', 'javascript:alert(1)', 'data:text/html,x', 'https://bit.ly/abc', 'https://linktr.ee/x', 'https://t.me/x', 'https://www.instagram.com/p/a b/', 'instagram.com/p/abc', '', '   ', 'https://x.com.evil.example/a', 'https://fakex.com/a', 'https://www.instagram.com/' + 'a'.repeat(600)])
    assert.equal(parseProofLink(bad).ok, false, bad.slice(0, 60))
  for (const v of [null, undefined, 5, {}]) assert.equal(parseProofLink(v).ok, false); assert.equal(safeProofLink('https://evil.example/x'), null); assert.equal(safeProofLink('https://x.com/a/status/1'), 'https://x.com/a/status/1')
})

console.log('metric segments (region / ad type)')
const defs: MetricDef[] = [{ category_key: 'digital_publisher_app', key: 'impressions', label: 'Impressions', unit: null, aggregation: 'sum', position: 10, active: true }]
const m = (seg: string | null, v: number, on: string): MetricEntry => ({ deliverable_id: 'D', category_key: 'digital_publisher_app', metric_key: 'impressions', value: v, recorded_on: on, created_at: on + 'T00:00:00Z', segment: seg })
test('each segment keeps its OWN running total: a newer reading replaces only its own segment, and the headline adds the segments', () => {
  const entries = [m('IN · Banner', 100, '2026-06-01'), m('IN · Banner', 250, '2026-06-05'), m('PK · Banner', 40, '2026-06-03'), m('IN · Interstitial', 10, '2026-06-02')]
  assert.equal(latestPerSubject(entries).length, 3); const s = summariseMetrics(entries, defs)[0]; assert.deepEqual([s.value, s.subjects, s.as_of], [300, 3, '2026-06-05'], '250 + 40 + 10 — India banner counted once, at its latest')
  assert.equal(summariseMetrics([m(null, 7, '2026-06-01'), m('IN', 5, '2026-06-01')], defs)[0].value, 12, 'an un-segmented reading is its own subject')
})

console.log('the brand report and the delivery log')
const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  generatedAt: '2026-08-10T00:00:00.000Z', asOf: '2026-08-10', title: 'T', brandName: 'B', branding: 'emergex', agentName: null,
  deliverables: [
    { id: 'P', description: 'Branded posts', status: 'partial', planned_quantity: 18, delivered_quantity: 3, unit: 'posts', due_date: '2026-08-08', period_label: 'LPL 2026', vendor_quantity: 4000000 },
    { id: 'W', description: 'Meet and greet', status: 'waived', planned_quantity: 1, delivered_quantity: 0, unit: null, due_date: '2026-08-09', waived_reason: 'INTERNAL-WAIVE-REASON' }],
  proofs: [
    { id: 'p1', deliverable_id: 'P', name: 'Instagram', kind: 'link', created_at: '2026-07-17T10:00:00Z', report_visible: true, archived_at: null, url: 'https://www.instagram.com/p/abc/' },
    { id: 'p2', deliverable_id: 'P', name: 'Odd link', kind: 'link', created_at: '2026-07-18T10:00:00Z', report_visible: true, archived_at: null, url: 'https://evil.example/steal' }],
  events: [
    { deliverable_id: 'P', occurred_on: '2026-07-17', quantity: 2, label: 'vs Jaffna Kings', voided_at: null, note: 'INTERNAL-EVENT-NOTE', created_by: 'user-secret' },
    { deliverable_id: 'P', occurred_on: '2026-07-18', quantity: 1, label: null, voided_at: null },
    { deliverable_id: 'P', occurred_on: '2026-07-19', quantity: 9, label: 'voided one', voided_at: '2026-07-20T00:00:00Z' },
    { deliverable_id: 'ZZ', occurred_on: '2026-07-19', quantity: 1, label: 'another project', voided_at: null }],
  entries: [], defs: [], ...over
})
test('log entries appear on the timeline with their label (or the quantity); voided ones and other projects\' never do', () => {
  assert.deepEqual(buildReport(input()).timeline.map((e) => `${e.date} ${e.type} ${e.text}`), ['2026-07-17 delivery Branded posts: vs Jaffna Kings', '2026-07-17 proof Proof added: Branded posts', '2026-07-18 delivery Branded posts: 1 posts delivered', '2026-07-18 proof Proof added: Branded posts', '2026-08-08 due Branded posts — due'])
  assert.deepEqual(buildReport(input({ events: undefined })).timeline.filter((e) => e.type === 'delivery'), [], 'no log, no delivery events')
})
test('a waived deliverable is shown as waived, counts for nothing, has no "due" entry — and its reason stays internal', () => {
  const r = buildReport(input()); const w = r.deliverables[1]; assert.deepEqual([w.status, w.pct], ['waived', 0]); assert.deepEqual([r.delivery.pct, r.delivery.counted, r.delivery.waived_excluded], [16.7, 1, 1], '3 of 18 = 16.7%, over ONE counted deliverable')
  assert.ok(!r.timeline.some((e) => e.text.includes('Meet and greet')), 'nothing is "due" for waived work')
})
test('the period is shown; the VENDOR\'s guarantee, the waive reason, log notes and who logged them are not', () => {
  const r = buildReport(input()); assert.equal(r.deliverables[0].period, 'LPL 2026'); assert.equal(r.deliverables[1].period, null)
  const blob = JSON.stringify(r); for (const secret of ['4000000', 'vendor_quantity', 'INTERNAL-WAIVE-REASON', 'waived_reason', 'INTERNAL-EVENT-NOTE', 'user-secret']) assert.ok(!blob.includes(secret), `LEAKED: ${secret}`)
  assert.deepEqual(Object.keys(r.deliverables[0]), ['id', 'description', 'period', 'status', 'planned', 'delivered', 'unit', 'pct', 'due_date', 'proofs']); assert.deepEqual(Object.keys(r.delivery), ['pct', 'counted', 'delivered', 'partial', 'planned', 'missed', 'replaced_excluded', 'waived_excluded'])
})
test('a social post link reaches the brand; a link to any other site is shown by name only, never as a link', () => {
  assert.deepEqual(buildReport(input()).deliverables[0].proofs.map((p) => [p.name, p.url]), [['Instagram', 'https://www.instagram.com/p/abc/'], ['Odd link', null]])
})
console.log(`\n${passed} passed`)
