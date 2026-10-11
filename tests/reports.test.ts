// Run with: npx tsx tests/reports.test.ts   (no database or network needed)
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { PDFDocument } from 'pdf-lib'
import { newToken, hashToken, isPlausibleToken, parseExpiryDays, linkState, ipHash, firstForwardedIp, daysLeft, EXPIRING_SOON_DAYS } from '../src/lib/reportToken'
import { addDays, addMonths, isIsoDay, nextDue, isSnapshotDue, overdueDays } from '../src/lib/reportCadence'
import { buildReport, metricSeries, reportForbiddenNames, reportLeaks, reportText, REPORT_KEYS, type ReportInput } from '../src/lib/reportBuilder'
import { renderReportPdf, toWinAnsi } from '../src/lib/reportPdf'
import { isReportShape } from '../src/lib/reportPublic'
import { pdfText } from './helpers_pdf'
import type { MetricDef } from '../src/lib/metrics'
void zlib
let passed = 0
const test = async (name: string, fn: () => void | Promise<void>) => { await fn(); passed++; console.log('  ok  ' + name) }

const defs: MetricDef[] = [
  { category_key: 'team', key: 'matches', label: 'Matches', unit: null, aggregation: 'sum', position: 10, active: true },
  { category_key: 'team', key: 'engagement_rate', label: 'Engagement rate', unit: '%', aggregation: 'avg', position: 20, active: true }]
const SECRETS = ['77777', 'CREDIT-NOTE-SECRET', 'Apex Sports Media', 'INTERNAL-NOTE', 'INTERNAL-PROOF-NOTE', 'DRIVE-ID-SECRET', 'user-secret', 'invoice_adjustment', 'vendor_name', 'hidden-internal.png', 'archived-proof.png', 'UPLOAD-URL-SECRET']
const hostile = { cost: 77777, invoice_adjustment: true, invoice_adjustment_note: 'CREDIT-NOTE-SECRET', vendor_name: 'Apex Sports Media', notes: 'INTERNAL-NOTE', margin_pct: 21 }
const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  generatedAt: '2026-06-22T08:00:00.000Z', asOf: '2026-06-22', title: 'Blitz - Gulf Premier League', brandName: 'Blitz', branding: 'emergex', agentName: 'Meridian Sports',
  deliverables: [
    { id: 'D1', description: 'Perimeter LED', status: 'delivered', planned_quantity: 10, delivered_quantity: 10, unit: 'matches', due_date: '2026-06-10', ...hostile },
    { id: 'D2', description: 'Social posts', status: 'partial', planned_quantity: 8, delivered_quantity: 6, unit: 'posts', due_date: '2026-06-20', ...hostile },
    { id: 'D3', description: 'Hospitality', status: 'missed', planned_quantity: 2, delivered_quantity: 0, unit: null, due_date: null, ...hostile },
    { id: 'D4', description: 'Old banner', status: 'replaced', planned_quantity: 1, delivered_quantity: 0, unit: null, due_date: '2026-06-01', ...hostile }],
  proofs: [
    { id: 'P1', deliverable_id: 'D1', name: 'screenshot.png', kind: 'upload', created_at: '2026-06-11T09:00:00Z', report_visible: true, archived_at: null, note: 'INTERNAL-PROOF-NOTE', drive_file_id: 'DRIVE-ID-SECRET', url: 'https://x.test/UPLOAD-URL-SECRET' },
    { id: 'P2', deliverable_id: 'D1', name: 'hidden-internal.png', kind: 'upload', created_at: '2026-06-11T10:00:00Z', report_visible: false, archived_at: null },
    { id: 'P3', deliverable_id: 'D2', name: 'archived-proof.png', kind: 'upload', created_at: '2026-06-15T10:00:00Z', report_visible: true, archived_at: '2026-06-16T00:00:00Z' },
    { id: 'P4', deliverable_id: 'D2', name: 'Insights', kind: 'link', created_at: '2026-06-21T10:00:00Z', report_visible: true, archived_at: null, url: 'https://drive.google.com/file/d/ABC123/view' }],
  entries: [
    { deliverable_id: 'D1', category_key: 'team', metric_key: 'matches', value: 3, recorded_on: '2026-06-05', created_at: '2026-06-05T10:00:00Z', source: 'Vendor: Apex Sports Media', recorded_by: 'user-secret' },
    { deliverable_id: 'D1', category_key: 'team', metric_key: 'matches', value: 8, recorded_on: '2026-06-12', created_at: '2026-06-12T10:00:00Z', source: 'Vendor: Apex Sports Media', recorded_by: 'user-secret' },
    { deliverable_id: 'D2', category_key: 'team', metric_key: 'matches', value: 4, recorded_on: '2026-06-12', created_at: '2026-06-12T11:00:00Z', source: 'x' },
    { deliverable_id: 'D1', category_key: 'team', metric_key: 'matches', value: 999, recorded_on: '2026-06-13', created_at: '2026-06-13T10:00:00Z', voided_at: '2026-06-13T11:00:00Z' },
    { deliverable_id: 'D1', category_key: 'team', metric_key: 'engagement_rate', value: 4, recorded_on: '2026-06-12', created_at: '2026-06-12T10:00:00Z' },
    { deliverable_id: 'D2', category_key: 'team', metric_key: 'engagement_rate', value: 6, recorded_on: '2026-06-12', created_at: '2026-06-12T10:00:00Z' }],
  defs, ...over
})

async function main() {
console.log('link tokens (L19)')
await test('a token is 256 random bits (43 URL-safe characters), unique, and only its SHA-256 is ever kept', () => {
  const t = newToken(); assert.match(t, /^[A-Za-z0-9_-]{43}$/); assert.equal(new Set(Array.from({ length: 2000 }, newToken)).size, 2000)
  assert.match(hashToken(t), /^[0-9a-f]{64}$/); assert.equal(hashToken(t), hashToken(t)); assert.notEqual(hashToken(t), hashToken(t + 'x')); assert.ok(!hashToken(t).includes(t.slice(0, 10)))
  assert.equal(hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'plain SHA-256')
})
await test('junk never counts as a possible token — it is refused before the database is asked', () => {
  assert.ok(isPlausibleToken(newToken()))
  for (const bad of ['', 'a'.repeat(42), 'a'.repeat(44), ' '.repeat(43), 'a'.repeat(42) + '=', 'a'.repeat(42) + '/', "' or 1=1 --" + 'a'.repeat(32), '../../etc/passwd', null, undefined, 5, {}, ['a'.repeat(43)]]) assert.equal(isPlausibleToken(bad), false, String(bad).slice(0, 30))
})
await test('expiry: 1–365 whole days, default 30; anything else is REFUSED, never clamped', () => {
  assert.deepEqual(parseExpiryDays(undefined), { ok: true, days: 30 }); assert.deepEqual(parseExpiryDays(1), { ok: true, days: 1 }); assert.deepEqual(parseExpiryDays(365), { ok: true, days: 365 })
  for (const bad of [0, -1, 366, 1.5, '7', NaN, Infinity, null, {}, true]) assert.equal(bad === null ? parseExpiryDays(bad).ok : parseExpiryDays(bad).ok, bad === null ? true : false, String(bad))
})
await test('a link is active, expired (at the instant it expires) or revoked; revoked wins', () => {
  const now = Date.parse('2026-06-01T12:00:00Z')
  assert.equal(linkState({ expires_at: '2026-06-01T12:00:01Z', revoked_at: null }, now), 'active'); assert.equal(linkState({ expires_at: '2026-06-01T12:00:00Z', revoked_at: null }, now), 'expired', 'exactly at expiry is already expired')
  assert.equal(linkState({ expires_at: '2026-07-01T00:00:00Z', revoked_at: '2026-06-01T00:00:00Z' }, now), 'revoked'); assert.equal(linkState({ expires_at: '2026-05-01T00:00:00Z', revoked_at: '2026-04-01T00:00:00Z' }, now), 'revoked')
})
await test('the viewer address is hashed PER LINK (so a person cannot be followed across links) and never stored raw', () => {
  const a = ipHash('203.0.113.9', 'link-1'), b = ipHash('203.0.113.9', 'link-2'); assert.notEqual(a, b); assert.equal(a, ipHash('203.0.113.9', 'link-1')); assert.ok(a && !a.includes('203')); assert.equal(ipHash(null, 'x'), null)
  assert.equal(firstForwardedIp('203.0.113.9, 10.0.0.1'), '203.0.113.9'); assert.equal(firstForwardedIp(null), null); assert.equal(firstForwardedIp('  '), null); assert.equal(firstForwardedIp('x'.repeat(200))!.length, 64)
})

console.log('snapshot cadence (L17)')
await test('date arithmetic: day steps across month, year and leap years; month steps clamp to month-end', () => {
  assert.equal(addDays('2026-06-30', 1), '2026-07-01'); assert.equal(addDays('2026-12-31', 1), '2027-01-01'); assert.equal(addDays('2024-02-28', 2), '2024-03-01'); assert.equal(addDays('2026-03-01', -1), '2026-02-28')
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28'); assert.equal(addMonths('2024-01-31', 1), '2024-02-29'); assert.equal(addMonths('2026-12-15', 1), '2027-01-15'); assert.equal(addMonths('2026-03-31', 1), '2026-04-30'); assert.equal(addMonths('2026-01-31', 13), '2027-02-28')
  for (const bad of ['2026-02-30', '2026-2-3', '26-02-03', '', 5, null]) assert.equal(isIsoDay(bad), false, String(bad)); assert.ok(isIsoDay('2024-02-29') && !isIsoDay('2026-02-29'))
})
await test('when is the next snapshot due: manual never; no earlier snapshot = today; then the cadence from the LAST cadence day', () => {
  assert.equal(nextDue('manual', '2026-06-10', '2026-06-20'), null); assert.equal(nextDue('daily', null, '2026-06-20'), '2026-06-20')
  assert.deepEqual((['daily', 'every_2_days', 'weekly', 'monthly'] as const).map((c) => nextDue(c, '2026-01-31', '2026-06-20')), ['2026-02-01', '2026-02-02', '2026-02-07', '2026-02-28'])
})
await test('due exactly on the due day (not the day before), and a long-overdue one is due once — not once per missed day', () => {
  assert.equal(isSnapshotDue('daily', '2026-06-10', '2026-06-10'), false); assert.equal(isSnapshotDue('daily', '2026-06-10', '2026-06-11'), true); assert.equal(isSnapshotDue('every_2_days', '2026-06-10', '2026-06-11'), false); assert.equal(isSnapshotDue('every_2_days', '2026-06-10', '2026-06-12'), true)
  assert.equal(isSnapshotDue('weekly', '2026-06-10', '2026-06-16'), false); assert.equal(isSnapshotDue('weekly', '2026-06-10', '2026-06-17'), true); assert.equal(isSnapshotDue('monthly', '2026-01-31', '2026-02-27'), false); assert.equal(isSnapshotDue('monthly', '2026-01-31', '2026-02-28'), true)
  assert.equal(isSnapshotDue('manual', null, '2026-06-20'), false); assert.equal(isSnapshotDue('daily', '2026-01-01', '2026-06-20'), true)
})

console.log('report alerts (L26/L27)')
await test('"late" means days PAST the due day — not due yet and due today are both 0 (the daily job has not had its chance); manual is never late', () => {
  assert.equal(overdueDays('daily', '2026-06-10', '2026-06-10'), 0); assert.equal(overdueDays('daily', '2026-06-10', '2026-06-11'), 0, 'due today, not late'); assert.equal(overdueDays('daily', '2026-06-10', '2026-06-12'), 1); assert.equal(overdueDays('daily', '2026-06-10', '2026-06-20'), 9)
  assert.equal(overdueDays('weekly', '2026-06-10', '2026-06-17'), 0); assert.equal(overdueDays('weekly', '2026-06-10', '2026-06-20'), 3); assert.equal(overdueDays('monthly', '2026-01-31', '2026-03-01'), 1, 'due 28 Feb')
  assert.equal(overdueDays('manual', '2020-01-01', '2026-06-20'), 0); assert.equal(overdueDays('daily', null, '2026-06-20'), 0, 'no snapshot yet: due today, not late')
})
await test('days left on a link round UP, so "expires today" still reads 1; the warning window is 7 days', () => {
  const now = Date.parse('2026-06-01T12:00:00Z'); assert.equal(daysLeft('2026-06-02T08:00:00Z', now), 1, '20 hours left'); assert.equal(daysLeft('2026-06-08T12:00:00Z', now), 7); assert.equal(daysLeft('2026-06-08T12:00:01Z', now), 8); assert.equal(daysLeft('2026-06-01T12:00:00Z', now), 0); assert.ok(daysLeft('2026-05-30T00:00:00Z', now) < 0); assert.equal(EXPIRING_SOON_DAYS, 7)
})

console.log('the brand-facing report (L16) — an allow-list, tested against planted secrets')
await test('the report has EXACTLY the allow-listed shape, at every level', () => {
  const r = buildReport(input()); assert.deepEqual(Object.keys(r), [...REPORT_KEYS])
  assert.deepEqual(Object.keys(r.deliverables[0]), ['id', 'description', 'status', 'planned', 'delivered', 'unit', 'pct', 'due_date', 'proofs']); assert.deepEqual(Object.keys(r.deliverables[0].proofs[0]), ['id', 'name', 'kind', 'added_on', 'url'])
  assert.deepEqual(Object.keys(r.branding), ['mode', 'agent_name']); assert.deepEqual(Object.keys(r.delivery), ['pct', 'counted', 'delivered', 'partial', 'planned', 'missed', 'replaced_excluded']); assert.deepEqual(Object.keys(r.metrics), ['summary', 'series'])
  assert.deepEqual(Object.keys(r.metrics.summary[0]), ['label', 'value', 'unit', 'aggregation', 'as_of', 'readings']); assert.deepEqual(Object.keys(r.timeline[0]), ['date', 'type', 'text'])
})
await test('NONE of the planted secrets — costs, vendors, internal notes, the invoice flag, who recorded what, a metric\'s source, hidden or archived proof — reaches the report', () => {
  const blob = JSON.stringify(buildReport(input())); for (const s of SECRETS) assert.ok(!blob.includes(s), `LEAKED: ${s}`)
  assert.ok(blob.includes('screenshot.png') && blob.includes('Insights'), 'while the proof that WAS ticked is there')
})
await test('only proof that is ticked AND not archived is shown; a link keeps its URL, an upload never has one', () => {
  const r = buildReport(input()); assert.deepEqual(r.deliverables.map((d) => d.proofs.map((p) => p.name)), [['screenshot.png'], ['Insights'], [], []])
  assert.deepEqual([r.deliverables[0].proofs[0].url, r.deliverables[1].proofs[0].url], [null, 'https://drive.google.com/file/d/ABC123/view'])
  assert.deepEqual(buildReport(input({ proofs: input().proofs.map((p) => ({ ...p, report_visible: false })) })).deliverables.flatMap((d) => d.proofs), [], 'nothing ticked = no proof at all (the default)')
})
await test('delivery %: per deliverable and overall, a replaced one is shown but not counted, a missed one counts as its delivered share', () => {
  const r = buildReport(input()); assert.deepEqual(r.deliverables.map((d) => [d.status, d.pct]), [['delivered', 100], ['partial', 75], ['missed', 0], ['replaced', 0]])
  assert.deepEqual(r.delivery, { pct: 58.3, counted: 3, delivered: 1, partial: 1, planned: 0, missed: 1, replaced_excluded: 1 }, '(100 + 75 + 0) ÷ 3')
  assert.deepEqual(buildReport(input({ deliverables: [] })).delivery.pct, null, 'nothing to deliver shows no % rather than a false 0 or 100')
})
await test('metrics: the LATEST reading per deliverable (newer replaces older), voided readings ignored, counts added, rates averaged', () => {
  const r = buildReport(input()); assert.deepEqual(r.metrics.summary, [{ label: 'Matches', value: 12, unit: null, aggregation: 'sum', as_of: '2026-06-12', readings: 2 }, { label: 'Engagement rate', value: 5, unit: '%', aggregation: 'avg', as_of: '2026-06-12', readings: 2 }])
  assert.deepEqual(r.metrics.series, [{ label: 'Matches', unit: null, points: [{ date: '2026-06-05', value: 3 }, { date: '2026-06-12', value: 12 }] }, { label: 'Engagement rate', unit: '%', points: [{ date: '2026-06-12', value: 5 }] }])
  assert.deepEqual(metricSeries([], defs), [])
})
await test('the timeline: due dates (not of replaced work), ticked proof, and readings — oldest first, voided readings absent', () => {
  assert.deepEqual(buildReport(input()).timeline.map((e) => `${e.date} ${e.type} ${e.text}`), [
    '2026-06-05 reading Matches reported: 3 (Perimeter LED)', '2026-06-10 due Perimeter LED — due', '2026-06-11 proof Proof added: Perimeter LED',
    '2026-06-12 reading Engagement rate reported: 4% (Perimeter LED)', '2026-06-12 reading Engagement rate reported: 6% (Social posts)', '2026-06-12 reading Matches reported: 4 (Social posts)', '2026-06-12 reading Matches reported: 8 (Perimeter LED)',
    '2026-06-20 due Social posts — due', '2026-06-21 proof Proof added: Social posts'])
  const many = buildReport(input({ entries: Array.from({ length: 300 }, (_, i) => ({ deliverable_id: null, category_key: 'team', metric_key: 'matches', value: i, recorded_on: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, created_at: '2026-01-01T00:00:00Z' })) })); assert.equal(many.timeline.length, 200, 'capped, keeping the most recent')
})
await test('branding (L18): EmergeX never carries an agent name; agent and co-branded show the NAME only (D17)', () => {
  assert.deepEqual(buildReport(input({ branding: 'emergex' })).branding, { mode: 'emergex', agent_name: null }); assert.deepEqual(buildReport(input({ branding: 'agent' })).branding, { mode: 'agent', agent_name: 'Meridian Sports' }); assert.deepEqual(buildReport(input({ branding: 'co_branded' })).branding, { mode: 'co_branded', agent_name: 'Meridian Sports' })
})
await test('unknown statuses are dropped rather than shown; a malformed row cannot break the report', () => {
  const r = buildReport(input({ deliverables: [...input().deliverables, { id: 'X', description: 'Odd', status: 'internal_hold', planned_quantity: 1, delivered_quantity: 0, unit: null, due_date: null }] })); assert.ok(!r.deliverables.some((d) => d.id === 'X'))
})

console.log('the fail-closed leak check (D18: delivery-side names stay hidden)')
await test('forbidden names are the vendors and delivery-side agents, in full and by distinctive word', () => {
  const f = reportForbiddenNames(['Apex Sports Media'], ['Meridian Delivery Agents']); for (const n of ['Apex Sports Media', 'Apex', 'Meridian Delivery Agents', 'Meridian', 'Delivery']) assert.ok(f.includes(n), n); assert.ok(!f.includes('Sports') && !f.includes('Media'))
})
await test('a vendor name anywhere readable — a deliverable, a proof name, a case change — is caught; a clean report passes', () => {
  const f = reportForbiddenNames(['Apex Sports Media'], []); assert.deepEqual(reportLeaks(buildReport(input()), f), [])
  assert.deepEqual(reportLeaks(buildReport(input({ deliverables: [{ ...input().deliverables[0], description: 'APEX perimeter boards' }] })), f), ['Apex'])
  assert.deepEqual(reportLeaks(buildReport(input({ proofs: [{ ...input().proofs[0], name: 'invoice-apex-sports-media.pdf' }] })), f).includes('Apex'), true)
  assert.ok(reportText(buildReport(input())).includes('Perimeter LED') && !reportText(buildReport(input())).includes('"id"'), 'values, not keys')
})

await test('a STORED snapshot is recognised whatever order its keys come back in (jsonb re-orders them) — and anything with extra, missing or renamed keys is not', () => {
  const r = buildReport(input()); const shuffled = Object.fromEntries(Object.entries(r).reverse()); assert.equal(isReportShape(r), true); assert.equal(isReportShape(shuffled), true); assert.equal(isReportShape(JSON.parse(JSON.stringify(shuffled))), true)
  assert.equal(isReportShape({ ...r, cost: 5 }), false); const { title, ...missing } = r; void title; assert.equal(isReportShape(missing), false); assert.equal(isReportShape({ ...missing, ttle: 'x' }), false); for (const bad of [null, undefined, [], 'x', 5, {}]) assert.equal(isReportShape(bad), false)
})
console.log('the PDF (L20)')
await test('characters the PDF fonts cannot draw become "?" instead of crashing the export; accents and dashes survive', () => {
  assert.equal(toWinAnsi('Café – “quoted” €5'), 'Café – “quoted” €5'); assert.equal(toWinAnsi('₹500'), '?500'); assert.equal(toWinAnsi('مرحبا'), '?????'); assert.equal(toWinAnsi('a\nb\tc'), 'a b c'); assert.equal(toWinAnsi('x\u0000y'), 'xy'); assert.equal(toWinAnsi('🙂'), '?')
})
await test('a real PDF: valid, one page for a small report, and the text it holds is exactly the allow-listed report — no secret in it', async () => {
  const bytes = await renderReportPdf(buildReport(input())); assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-'); const doc = await PDFDocument.load(bytes); assert.equal(doc.getPageCount(), 1)
  const t = pdfText(bytes); for (const must of ['Blitz - Gulf Premier League', 'Prepared for Blitz', 'Delivery 58.3%', 'Perimeter LED', '10 of 10 matches', 'Social posts', 'Matches: 12', 'Engagement rate: 5%', 'screenshot.png', 'page 1 of 1']) assert.ok(t.includes(must), `missing: ${must}`)
  for (const s of SECRETS) assert.ok(!t.includes(s), `LEAKED INTO THE PDF: ${s}`)
})
await test('branding in the PDF: EmergeX, the agent alone, or both', async () => {
  const txt = async (b: 'emergex' | 'agent' | 'co_branded') => pdfText(await renderReportPdf(buildReport(input({ branding: b, title: 'T' }))))
  const e = await txt('emergex'), a = await txt('agent'), c = await txt('co_branded'); assert.ok(e.includes('EmergeX') && !e.includes('Meridian')); assert.ok(a.includes('Meridian Sports') && !a.includes('EmergeX')); assert.ok(c.includes('EmergeX  x  Meridian Sports'))
})
await test('a long report paginates (every page numbered); hostile text — a 5,000-character word, non-Latin script — cannot crash it', async () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ id: `Z${i}`, description: `Deliverable number ${i}`, status: 'delivered', planned_quantity: 1, delivered_quantity: 1, unit: 'x', due_date: '2026-06-01' }))
  const bytes = await renderReportPdf(buildReport(input({ deliverables: many, proofs: [] }))); const doc = await PDFDocument.load(bytes); const n = doc.getPageCount(); assert.ok(n >= 3, `pages: ${n}`); const t = pdfText(bytes); assert.ok(t.includes(`page 1 of ${n}`) && t.includes(`page ${n} of ${n}`))
  const rough = await renderReportPdf(buildReport(input({ title: 'ملعب ₹ 🙂', brandName: 'Bl\u0000itz', deliverables: [{ id: 'H', description: 'W'.repeat(5000), status: 'planned', planned_quantity: 1, delivered_quantity: 0, unit: null, due_date: null }] }))); assert.equal(Buffer.from(rough.slice(0, 5)).toString(), '%PDF-'); assert.ok((await PDFDocument.load(rough)).getPageCount() >= 1)
})
console.log(`\n${passed} passed`)
}
main().catch((e) => { console.error(e); process.exit(1) })
