// Run with: npx tsx tests/trackerimport2.test.ts   (no database or network needed)
// The ad-campaign and status-list importers, on synthetic sheets reproducing what a real publisher report and a real status list showed.
import assert from 'node:assert/strict'
import { cell as c, type Sheet } from '../src/lib/tracker/grid'
import { parseCampaignSheet, parseCampaignDaily, cellDay, normRegion, normAdType } from '../src/lib/tracker/adCampaign'
import { parseStatusList, matchDeliverable } from '../src/lib/tracker/statusList'
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name) }
const row = (...v: (string | number | null | ReturnType<typeof c>)[]) => v.map((x) => (x !== null && typeof x === 'object' ? x : c(x as string | number | null)))
const sheet = (name: string, ...rows: ReturnType<typeof row>[]): Sheet => ({ name, rows })

console.log('ad-campaign report')
test('regions, ad types and lost date formats are normalised', () => {
  assert.deepEqual(['IND', 'india', 'IN', 'PAKISTAN', 'pk', 'BD', 'Bangladesh', 'Kenya'].map(normRegion), ['IN', 'IN', 'IN', 'PK', 'PK', 'BD', 'BD', 'KENYA']); assert.deepEqual(['Intersitial Ads', 'INTERSTITIAL', 'Banner Ads', 'Video pre-roll'].map(normAdType), ['Interstitial', 'Interstitial', 'Banner', 'Video'])
  assert.equal(cellDay(c(45928)), '2025-09-28', 'a raw spreadsheet serial where the date format was lost'); assert.equal(cellDay(c('2025-09-28', { date: '2025-09-28' })), '2025-09-28'); for (const no of [c(5), c(4000000), c('soon'), c(null), undefined]) assert.equal(cellDay(no), null)
})
const single = sheet('BB7', row('BETBRICKS', 'BETBRICKS'), row(), row('GTD IMPRESSIONS', 4000000), row('IMPRESSIONS SERVED', 4044200), row('IMPRESSIONS PENDING', -44200), row('CLICKS', 60572), row('CTR', 0.01497), row('AMOUNT SPENT', null), row(),
  row('IND', 'IND', 'IND', 'IND'), row('ADS Type', 'Impression', 'Clicks', 'CTR'), row('Intersitial Ads', 1197436, 50513, 0.0421), row('Banner Ads', 2846764, 10059, 0.0035), row(null, 4044200, 60572, 0.0149))
test('a one-block sheet: segments by region and ad type, totals — and its GTD is NOT assumed to be the brand\'s', () => {
  const r = parseCampaignSheet(single); assert.deepEqual(r.segments.map((s) => [s.segment, s.impressions, s.clicks]), [['IN · Interstitial', 1197436, 50513], ['IN · Banner', 2846764, 10059]]); assert.deepEqual(r.totals, { impressions: 4044200, clicks: 60572 })
  assert.deepEqual([r.sheetGtd, r.brandGtd, r.vendorGtd], [4000000, null, null], 'an internal sheet\'s single "GTD" may be the publisher\'s figure — the reviewer says which'); assert.deepEqual(r.checks, [], 'a self-consistent sheet raises nothing')
})
const twin = sheet('N88', row('N88 (CricketlineX)', 'N88 (CricketlineX)', null, 'N88 (Brand)', 'N88 (Brand)'), row('CAMPAIGN DATE', 45923, null, 'CAMPAIGN DATE', c('2025-09-23', { date: '2025-09-23' })), row('GTD IMPRESSIONS', 15000000, null, 'GTD IMPRESSIONS', 13000000),
  row('IMPRESSIONS SERVED', 14441699, null, 'IMPRESSIONS SERVED', 14441699), row('IMPRESSIONS PENDING', 558301, null, 'IMPRESSIONS PENDING', -1441699), row('CLICKS', 148880, null, 'CLICKS', 148880), row(),
  row('BD', 'BD', 'BD', 'BD', 'BD'), row('ADS Type', 'GTD Impressions', 'Impressions Served', 'Clicks', 'CTR'), row('Intersitial Ads', 3000000, 1306377, 113467, 0.0869), row('Banner Ads', 12000000, 13135322, 35413, 0.0027), row('Total', 15000000, 14441699, 148880, 0.0103))
test('two side-by-side blocks: what the PUBLISHER guarantees us and what WE guarantee the brand are kept apart', () => {
  const r = parseCampaignSheet(twin); assert.deepEqual([r.vendorGtd, r.brandGtd, r.sheetGtd], [15000000, 13000000, null]); assert.deepEqual(r.blocks.map((b) => [b.side, b.campaignDate]), [['vendor', '2025-09-23'], ['brand', '2025-09-23']], 'the raw serial 45923 and the real date agree')
  assert.deepEqual(r.segments.map((s) => [s.segment, s.gtd, s.impressions, s.clicks]), [['BD · Interstitial', 3000000, 1306377, 113467], ['BD · Banner', 12000000, 13135322, 35413]], '"Impressions Served" is the delivered figure, not the GTD column')
  assert.deepEqual(r.checks, [], 'pending = guaranteed − served on both sides')
})
test('a report that disagrees with itself is FLAGGED: totals that do not add up, impossible click-through rates, a copied region, a wrong "pending"', () => {
  const bad = sheet('W999', row('W999', 'W999'), row('GTD IMPRESSIONS', 7000000), row('IMPRESSIONS SERVED', 7771682), row('IMPRESSIONS PENDING', -1771682), row('CLICKS', 206250), row(),
    row('INDIA', 'INDIA', 'INDIA', 'INDIA'), row('ADS Type', 'Impression', 'Clicks', 'CTR'), row('Intersitial Ads', 204392, 61470, 0.3007), row('Banner Ads', 3532281, 14708, 0.0042), row('TOTAL', 9999999, 76178, 0.02), row(),
    row('PK', 'PK', 'PK', 'PK'), row('ADS Type', 'Impression', 'Clicks', 'CTR'), row('Intersitial Ads', 144848, 7769, 0.05), row('Banner Ads', 2308339, 4910, 0.002), row(),
    row('BD', 'BD', 'BD', 'BD'), row('ADS Type', 'Impression', 'Clicks', 'CTR'), row('Intersitial Ads', 144848, 7769, 0.05), row('Banner Ads', 2308339, 4910, 0.002))
  const r = parseCampaignSheet(bad); const has = (re: RegExp) => assert.ok(r.checks.some((x) => re.test(x)), `expected a check matching ${re}: ${JSON.stringify(r.checks)}`)
  has(/"pending" is -1,771,682, but guaranteed . served is -771,682/); has(/IN · Interstitial: a click-through rate of 30\.1% is implausibly high/); has(/IN: its total row says 9,999,999 impressions, but its rows add up to 3,736,673/)
  has(/PK and BD have IDENTICAL figures/); has(/summary says 7,771,682 impressions served, but the regional tables add up to 8,643,047/); has(/summary says 206,250 clicks, but the regional tables add up to 101,536/)
  assert.equal(r.segments.length, 6)
})
test('a plain table of regions (no ad types) is read; a sheet that is not a report gives nothing', () => {
  const t = parseCampaignSheet(sheet('Sheet9', row('ADS Type', 'GTD Impression', 'Impression', 'Clicks', 'CTR'), row('INDIA', 80000000, 27674338, 196324, 0.007), row('PAKISTAN', 6000000, 4345985, 43100, 0.0099), row('Total', 86000000, 32020323, 239424, 0.0074)))
  assert.deepEqual(t.segments.map((s) => [s.segment, s.gtd, s.impressions]), [['IN', 80000000, 27674338], ['PK', 6000000, 4345985]]); assert.deepEqual(parseCampaignSheet(sheet('x', row('Player', 'Followers'), row('A', 5))).segments, [])
})
const d = (iso: string) => c(iso, { date: iso })
const daily = sheet('TEMPLATE', row('Column 1', 'Column 2', 'Type of Inventory', 'GTD Impressions', 'Delivered', 'Total Clicks', 'Total CTR', 'Shortfall'),
  row(d('2025-11-17'), 'INDIA', 'BANNER', 1000, 600, 6, 0.01, 400), row(d('2025-11-17'), 'PK', 'BANNER', 100, 50, 1, 0.02, '\\'), row(d('2025-11-18'), 'INDIA', 'BANNER', 1000, 400, 4, 0.01, 600), row(d('2025-11-18'), 'INDIA', 'INTERSTITIAL', 200, 100, 9, 0.09, 100),
  row(d('2025-11-24'), 'INDIA', 'BANNER', 1000, 1000, 10, 0.01, 0), row(d('2025-11-25'), 'PK', 'BANNER', 100, 70, null, 0, 30), row(null, 'INDIA', 'BANNER', 1, 999, 9, 0, 0), row(d('2025-11-25'), 'INDIA', null, 1, 999, 9, 0, 0), row(d('2025-11-25'), 'BD', 'BANNER', 0, null, null, 0, null))
test('daily rows are ADDED UP into running totals per region and ad type, keeping one reading per week plus the last day', () => {
  const r = parseCampaignDaily(daily); assert.deepEqual([r.headerRow, r.rowsRead, r.rowsSkipped, r.days, r.firstDay, r.lastDay], [1, 6, 3, 4, '2025-11-17', '2025-11-25'])
  assert.deepEqual(r.segments.map((s) => [s.segment, s.impressions, s.clicks, s.gtd]), [['IN · Banner', 2000, 20, 3000], ['IN · Interstitial', 100, 9, 200], ['PK · Banner', 120, 1, 200]], 'India banner: 600 + 400 + 1,000')
  assert.deepEqual(r.readings, [{ recorded_on: '2025-11-18', segment: 'IN · Banner', impressions: 1000, clicks: 10 }, { recorded_on: '2025-11-18', segment: 'IN · Interstitial', impressions: 100, clicks: 9 }, { recorded_on: '2025-11-18', segment: 'PK · Banner', impressions: 50, clicks: 1 },
    { recorded_on: '2025-11-25', segment: 'IN · Banner', impressions: 2000, clicks: 20 }, { recorded_on: '2025-11-25', segment: 'IN · Interstitial', impressions: 100, clicks: 9 }, { recorded_on: '2025-11-25', segment: 'PK · Banner', impressions: 120, clicks: 1 }], 'week 1 ends on its last day with data (the 18th); week 2 on the 25th — each a RUNNING total')
  assert.deepEqual(r.totals, { impressions: 2220, clicks: 30 }); assert.ok(r.checks.some((x) => /3 rows were skipped/.test(x))); assert.equal(parseCampaignDaily(sheet('x', row('a', 'b'), row(1, 2))).headerRow, null)
})

console.log('status list')
const dels = [{ id: 'd1', description: 'No. of LED Boards' }, { id: 'd2', description: 'Logo on Giant Screen' }, { id: 'd3', description: 'Meet & Greet' }, { id: 'd4', description: 'Branded posts' }, { id: 'd5', description: 'Player signed Jerseys' }, { id: 'd6', description: 'Hospitality Tickets' }]
test('a tracker row is matched to the contract\'s wording, ignoring filler — and NOT matched when it is ambiguous or absent', () => {
  const m = (n: string, list = dels) => matchDeliverable(n, list)?.id ?? null
  assert.deepEqual(['LED Boards', 'Giant screen', 'Meet & Greet', 'branded post', 'Player signed Jerseys', 'Hospitality tickets'].map((n) => m(n)), ['d1', 'd2', 'd3', 'd4', 'd5', 'd6']); assert.equal(m('Match Images'), null, 'nothing like it on the contract'); assert.equal(m(''), null)
  assert.equal(m('Posts', [{ id: 'a', description: 'Instagram posts' }, { id: 'b', description: 'Facebook posts' }]), null, 'two equally good candidates: a person chooses'); assert.equal(m('Jerseys', [{ id: 'a', description: 'Player signed jerseys and bats and caps and balls' }]), null, 'one shared word out of many is not a match')
})
const status = sheet('Progress', row('Galle x Brand', 'Galle x Brand', 'Galle x Brand'), row('Deliverables', 'Comments', 'Links'), row('BEFORE MATCH', 'BEFORE MATCH', 'BEFORE MATCH'), row('Hospitality Tickets', 'Not Completed', null),
  row('Branded posts', 'Completed', c('https://docs.google.com/spreadsheets/d/1Ueae/edit', { link: 'https://docs.google.com/spreadsheets/d/1Ueae/edit?usp=sharing' })), row('DURING MATCH', 'DURING MATCH', 'DURING MATCH'), row('LED Boards', 'Completed', 'https://drive.google.com/drive/folders/15Ep1'), row('Match Images', 'Completed', 'https://evil.example/pics'),
  row('AFTER MATCH', 'AFTER MATCH', 'AFTER MATCH'), row('Meet & Greet', 'Not Completed', 'not wanted by brand'), row('Giant screen', 'half done', null))
test('each row: its section, done or not, its proof link or remark, a suggested action and the deliverable it matches', () => {
  const r = parseStatusList(status, dels); assert.equal(r.headerRow, 2); assert.deepEqual(r.rows.map((x) => [x.name, x.section, x.status, x.suggestion, x.match]), [
    ['Hospitality Tickets', 'BEFORE MATCH', 'not_completed', 'none', 'd6'], ['Branded posts', 'BEFORE MATCH', 'completed', 'complete', 'd4'], ['LED Boards', 'DURING MATCH', 'completed', 'complete', 'd1'], ['Match Images', 'DURING MATCH', 'completed', 'complete', null],
    ['Meet & Greet', 'AFTER MATCH', 'not_completed', 'waive', 'd3'], ['Giant screen', 'AFTER MATCH', 'unknown', 'none', 'd2']])
  assert.equal(r.unmatched, 1); assert.deepEqual(r.rows[1].links.map((l) => l.platform), ['drive']); assert.equal(r.rows[1].links.length, 1, 'text and hyperlink of one cell are one link')
  assert.deepEqual([r.rows[3].links, r.rows[3].rejected], [[], ['https://evil.example/pics']], 'a link that is not acceptable is listed, not attached'); assert.equal(r.rows[4].remark, 'not wanted by brand'); assert.equal(r.rows[5].remark, 'half done', 'an unrecognised status is kept as a remark')
})
test('"not wanted by brand" suggests WAIVE, never "not completed" alone; a sheet that is not a status list gives nothing', () => {
  const s = (remark: string | null, st = 'Not Completed') => parseStatusList(sheet('p', row('Deliverables', 'Comments', 'Links'), row('Meet & Greet', st, remark)), dels).rows[0].suggestion
  assert.deepEqual(['not wanted by brand', 'Brand no longer required this', 'waived by client', 'brand didn\'t want it', null, 'will do next week'].map((x) => s(x)), ['waive', 'waive', 'waive', 'waive', 'none', 'none'])
  assert.deepEqual(parseStatusList(sheet('x', row('ASSET', 'DETAILS'), row('A', 5)), dels), { headerRow: null, rows: [], unmatched: 0 })
})
console.log(`\n${passed} passed`)
