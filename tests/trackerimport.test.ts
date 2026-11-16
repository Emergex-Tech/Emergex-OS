// Run with: npx tsx tests/trackerimport.test.ts   (no database or network needed)
// Synthetic sheets that reproduce the quirks found in three REAL trackers (title rows above headers, links stored twice with a
// tracking parameter, "-" placeholders, pasted junk, a legend in the notes column, meaning carried by a green fill, loose dates).
import assert from 'node:assert/strict'
import { cell as c, parseLooseDate, isGreen, text, type Sheet } from '../src/lib/tracker/grid'
import { parsePostLog } from '../src/lib/tracker/postLog'
import { parseDeliverablesList, readQuantity } from '../src/lib/tracker/deliverablesList'
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name) }
const row = (...v: (string | number | null | ReturnType<typeof c>)[]) => v.map((x) => (x !== null && typeof x === 'object' ? x : c(x as string | number | null)))
const sheet = (name: string, ...rows: ReturnType<typeof row>[]): Sheet => ({ name, rows })

console.log('dates as people type them')
test('reads the common forms, day-first by default, and hands back any remark that followed the date', () => {
  const d = (s: string, o: 'dmy' | 'mdy' = 'dmy') => parseLooseDate(s, o).date
  assert.deepEqual(['1 August 2024', '4th October 2024', '22nd Dec 2025', '3rd Sept 2025', 'August 15, 2024', 'Aug 5 24', '15/08/2024', '15-08-24', '15.08.2024', '2024-08-15', '1 August 2024 ( Announcement Post'].map((s) => d(s)),
    ['2024-08-01', '2024-10-04', '2025-12-22', '2025-09-03', '2024-08-15', '2024-08-05', '2024-08-15', '2024-08-15', '2024-08-15', '2024-08-15', '2024-08-01'])
  assert.deepEqual(parseLooseDate('1 August 2024 ( Announcement Post'), { date: '2024-08-01', rest: 'Announcement Post' }); assert.deepEqual(parseLooseDate('12/05/2026 - launch'), { date: '2026-05-12', rest: 'launch' })
  assert.equal(d('05/12/2026', 'mdy'), '2026-05-12'); assert.equal(d('05/12/2026', 'dmy'), '2026-12-05', 'the same text, the other reading — the caller chooses')
})
test('impossible or unreadable dates are null — never rolled over, never guessed', () => {
  for (const bad of ['31 February 2026', '31/02/2026', '13/13/2026', '0 March 2026', 'sometime in May', '', 'TBC', '45928', '15 Smarch 2026', '2026-02-30', '1 August 1924']) assert.equal(parseLooseDate(bad).date, null, bad)
  assert.equal(parseLooseDate('29 February 2024').date, '2024-02-29'); assert.equal(parseLooseDate('29 February 2026').date, null)
})
test('green is recognised from a fill colour; other colours and junk are not', () => {
  for (const g of ['FF93C47D', 'FF00FF00', 'FFB6D7A8', '6AA84F']) assert.equal(isGreen(g), true, g); for (const n of ['FFFFFFFF', 'FFFF0000', 'FFFFFF00', 'FF4A86E8', '', null, 'zzz', 'FF000000']) assert.equal(isGreen(n as string | null), false, String(n))
  assert.equal(text(c('  a \n b  ')), 'a b'); assert.equal(text(undefined), '')
})

console.log('the post-log importer')
const IG = (id: string) => `https://www.instagram.com/p/${id}/`
const posts = sheet('SM Tracker',
  row('Sr No.', 'Date', 'Instagram Link', 'Facebook Link', 'Twitter Link', 'TikTok'),
  row(1, '1 August 2024 ( Announcement Post', c(IG('A1'), { link: IG('A1') + '?igsh=TRACK123' }), 'https://www.facebook.com/share/p/F1/', 'https://x.com/sunny/status/1', 'https://vt.tiktok.com/ZS1/'),
  row(2, '4th October 2024', c(IG('A2'), { link: IG('A2') }), 'https://fb.watch/abc/', '-', '-'),
  row(3, c('2024-10-27', { date: '2024-10-27' }), IG('A3'), null, null, null),
  row(4, 'soon', IG('A4'), 'https://evil.example/fake', null, null),
  row(5, null, IG('A5'), null, null, null),
  row(24, null, null, null, null, null), row(25, null, null, '-', null, null),
  row(null, null, null, null, 'Facebook', null), row(null, null, null, null, 'Log in or sign up to view', null), row(null, null, null, null, '19:02', null))
test('one entry per row: the date, every acceptable link with its platform, the remark as the label', () => {
  const r = parsePostLog(posts); assert.deepEqual([r.headerRow, r.dateColumn, r.rows.length], [1, 1, 5])
  assert.deepEqual([r.rows[0].date, r.rows[0].label, r.rows[0].links.map((l) => l.platform)], ['2024-08-01', 'Announcement Post', ['instagram', 'facebook', 'x', 'tiktok']])
  assert.deepEqual([r.rows[1].date, r.rows[1].links.map((l) => l.platform)], ['2024-10-04', ['instagram', 'facebook']], '"-" placeholders are not links'); assert.equal(r.rows[2].date, '2024-10-27', 'a real spreadsheet date is used as is')
})
test('a link stored twice — clean text plus a hyperlink with a tracking parameter — is ONE link, and the clean one is kept', () => {
  const r = parsePostLog(posts); assert.equal(r.rows[0].links.filter((l) => l.platform === 'instagram').length, 1); assert.equal(r.rows[0].links[0].url, IG('A1'), 'the visible, clean link — not the tracked one')
  const yt = parsePostLog(sheet('s', row('Date', 'Link'), row('1 May 2026', 'https://www.youtube.com/watch?v=AAA https://www.youtube.com/watch?v=BBB'))); assert.equal(yt.rows[0].links.length, 2, 'but two YouTube videos differ only in the query, and are two links')
})
test('junk is skipped, problems are reported per row, and a refused link is listed — never silently dropped', () => {
  const r = parsePostLog(posts); assert.equal(r.skipped, 5, 'two blank numbered rows and three lines of pasted text'); assert.equal(r.undated, 2)
  assert.deepEqual(r.rows[3].problems, ['could not read the date "soon"']); assert.deepEqual([r.rows[3].rejected, r.rejectedLinks], [['https://evil.example/fake'], 1]); assert.deepEqual(r.rows[4].problems, [], 'no date column value is not an error — the row is just undated')
  const only = parsePostLog(sheet('s', row('Date', 'Link'), row('1 May 2026', 'https://bit.ly/x'))); assert.deepEqual(only.rows[0].problems, ['no acceptable link'])
})
test('a tracker with no dates, a legend in the notes column, and meaning carried by GREEN cells', () => {
  const g = sheet('Post Tracker', row('Sr. No', 'Link', 'Post', null, '*notes'),
    row(1, c(IG('G1'), { link: IG('G1') + '?utm_source=x', fill: 'FF93C47D' }), null, null, 'Highlighted in green means brand has accepted those posts as collabs'),
    row(2, c(IG('G2'), { fill: 'FF93C47D' }), null, null, 'Rest, team has tagged or sent collab request to Brand, Brand hasnt accepted those'), row(3, c(IG('G3')), null, null, 'Reel'), row(4, c(IG('G4'), { fill: 'FFFFFFFF' }), null, null, null))
  const r = parsePostLog(g); assert.deepEqual([r.rows.length, r.undated, r.highlighted, r.dateColumn], [4, 4, 2, null]); assert.deepEqual(r.rows.map((x) => x.highlighted), [true, true, false, false])
  assert.deepEqual(r.rows.map((x) => x.label), [null, null, 'Reel', null], 'a legend is NOT a caption'); assert.equal(r.legends.length, 2); assert.match(r.legends[0], /green means brand has accepted/)
  assert.deepEqual(r.rows.map((x) => x.links.length), [1, 1, 1, 1])
})
test('a sheet that is not a post log gives nothing rather than a guess', () => {
  assert.deepEqual(parsePostLog(sheet('x', row('Name', 'Role'), row('A', 'B'))).rows, []); assert.deepEqual(parsePostLog(sheet('x')).rows, [])
})

console.log('the deliverables-list importer')
test('quantities: plain numbers, "per match / per year", ticks — and a HINT whenever it had to guess', () => {
  const q = (d: string) => { const r = readQuantity(d); return [r.quantity, r.per, r.unit] }
  assert.deepEqual([q('18'), q('6 per match'), q('24 per year'), q('2 Days per year'), q('1 DAY per year'), q('✓'), q('yes'), q('15 jerseys'), q('4')], [[18, null, null], [6, 'match', null], [24, 'year', null], [2, 'year', null], [1, 'year', null], [1, null, null], [1, null, null], [15, null, 'jerseys'], [4, null, null]])
  assert.match(readQuantity('').hint ?? '', /assumed 1/); assert.match(readQuantity('All Posts').hint ?? '', /could not read/); assert.match(readQuantity('0.2').hint ?? '', /less than 1/); assert.match(readQuantity('206.5 sq cm').hint ?? '', /size or length/); assert.equal(readQuantity('206.5 sq cm').quantity, 1)
  assert.equal(readQuantity('18').hint, null); assert.match(readQuantity('6 per match').hint ?? '', /number of matches/)
})
test('a title row above the header, "DELIVERABLES/T&CS", per-year quantities, and contract terms left unticked', () => {
  const s = sheet('Deliverables', row('SUNNY LEONE BRAND AMBASSADOR', 'SUNNY LEONE BRAND AMBASSADOR', 'SUNNY LEONE BRAND AMBASSADOR', 'SUNNY LEONE BRAND AMBASSADOR'), row('SR NO', 'DELIVERABLES/T&CS', 'DETAILS', 'REMARKS'),
    row(1, 'Brand shoot (Static and video)', '2 Days per year', '8 Hours per day'), row(2, 'Social Media Posts on IG/FB/TikTok', '24 per year', 'Reel+Static'), row(3, 'Collaboration with Brand Page', 'All Posts', null),
    row(4, 'Category Exclusivity - Casino & Sportsbook', 'Year 1 - Casino', null), row(5, 'Contract Length', '3 Years', null), row(6, 'Contract Date', '15 th July 24 - 30th June 26', null), row(7, 'Region of Rights', 'Global', null))
  const r = parseDeliverablesList(s); assert.equal(r.headerRow, 2); assert.deepEqual(r.rows.map((x) => [x.description.slice(0, 22), x.kind, x.include, x.quantity, x.per]), [
    ['Brand shoot (Static an', 'deliverable', true, 2, 'year'], ['Social Media Posts on ', 'deliverable', true, 24, 'year'], ['Collaboration with Bra', 'deliverable', true, 1, null],
    ['Category Exclusivity -', 'term', false, 1, null], ['Contract Length', 'term', false, 3, null], ['Contract Date', 'term', false, 15, null], ['Region of Rights', 'term', false, 1, null]])
  assert.equal(r.rows[1].remarks, 'Reel+Static')
})
test('ASSET / DETAILS / COMMENT: a tier row is not a deliverable, a size in the NAME is not a quantity, an odd number is flagged', () => {
  const s = sheet('Deliverables', row('ASSET', 'DETAILS', 'COMMENT'), row('Category', 'Principal (FOJ)', null), row('Rights to Use Player Images', '✓', null), row('Hospitality Tickets', '6 per match', null), row('Branded posts', 18, null),
    row('Logo Size (sq. cm)', 206.5, null), row('Logo on Giant Screen', 0.2, 'please clarify'), row('Bat Stickers', 15, null), row(null, null, null))
  const r = parseDeliverablesList(s); assert.deepEqual(r.rows.map((x) => [x.description, x.kind, x.quantity, x.per]), [['Category', 'term', 1, null], ['Rights to Use Player Images', 'deliverable', 1, null], ['Hospitality Tickets', 'deliverable', 6, 'match'], ['Branded posts', 'deliverable', 18, null], ['Logo Size (sq. cm)', 'deliverable', 1, null], ['Logo on Giant Screen', 'deliverable', 1, null], ['Bat Stickers', 'deliverable', 15, null]])
  assert.match(r.rows[4].hint ?? '', /not a quantity/); assert.match(r.rows[5].hint ?? '', /less than 1/); assert.equal(r.rows[5].remarks, 'please clarify')
})
test('a sheet with no recognisable list gives nothing', () => { assert.deepEqual(parseDeliverablesList(sheet('x', row('Player', 'Followers'), row('A', 100))), { headerRow: null, rows: [] }); assert.deepEqual(parseDeliverablesList(sheet('x')).rows, []) })
console.log(`\n${passed} passed`)
