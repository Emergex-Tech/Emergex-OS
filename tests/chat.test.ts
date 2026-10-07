// Run with: npx tsx tests/chat.test.ts   (no database or network needed)
import assert from 'node:assert/strict'
import { parseChat, suggestKind, formatSummary, dedupeKey, MAX_MESSAGES, MAX_CHARS } from '../src/lib/chatParse'
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name) }

console.log('formats')
test('WhatsApp (iPhone): messages, a multi-line message, and a system line that is skipped', () => {
  const r = parseChat(['[12/05/2026, 10:32:15] Rahul (EmergeX): Please send the assets?', '[12/05/2026, 10:35:02] Vendor Ops: Sent them just now', 'second line of that message', '[12/05/2026, 10:36:00] Messages and calls are end-to-end encrypted.'].join('\n'))
  assert.equal(r.format, 'whatsapp_ios'); assert.equal(r.messages.length, 2); assert.equal(r.skippedSystem, 1)
  assert.deepEqual(r.messages[0], { index: 0, occurred_at: '2026-05-12T10:32:15.000Z', sender: 'Rahul (EmergeX)', text: 'Please send the assets?' })
  assert.equal(r.messages[1].text, 'Sent them just now\nsecond line of that message')
})
test('WhatsApp (Android): 12-hour clock — 12 pm is noon, 12:30 am is just after midnight', () => {
  const r = parseChat(['12/05/26, 9:05 am - Anna: Hello', '12/05/26, 12:00 pm - Bob: noon', '12/05/26, 12:30 am - Bob: after midnight', '12/05/26, 11:59 PM - Anna: late', '12/05/26, 6:00 p.m. - Anna: dotted'].join('\n'))
  assert.equal(r.format, 'whatsapp_android'); assert.deepEqual(r.messages.map((m) => m.occurred_at.slice(11, 16)), ['09:05', '12:00', '00:30', '23:59', '18:00']); assert.equal(r.messages[0].occurred_at.slice(0, 10), '2026-05-12', 'a 2-digit year means 20yy')
})
test('Telegram: a header line, then the message on the following lines', () => {
  const r = parseChat('Rahul, [12.05.2026 10:32]\nPlease confirm the date\n\nVendor Ops, [12.05.2026 10:40]\nConfirmed\nfor the 14th')
  assert.equal(r.format, 'telegram'); assert.deepEqual(r.messages.map((m) => [m.sender, m.text]), [['Rahul', 'Please confirm the date'], ['Vendor Ops', 'Confirmed\nfor the 14th']])
})
test('invisible direction marks that WhatsApp adds are ignored; a colon later in the text stays in the text', () => {
  const r = parseChat('\u200e[12/05/2026, 10:32:15] \u200eAnna: note: see below'); assert.deepEqual([r.messages[0].sender, r.messages[0].text], ['Anna', 'note: see below'])
})
console.log('dates')
test('day/month vs month/day is the CALLER\'s choice, and the same text reads differently', () => {
  assert.equal(parseChat('05/12/2026, 10:32 - X: hi', { dateOrder: 'dmy' }).messages[0].occurred_at.slice(0, 10), '2026-12-05'); assert.equal(parseChat('05/12/2026, 10:32 - X: hi', { dateOrder: 'mdy' }).messages[0].occurred_at.slice(0, 10), '2026-05-12')
})
test('an impossible date is REFUSED and counted, not rolled over into another month', () => {
  const r = parseChat(['31/02/2026, 10:00 - X: nope', '13/13/2026, 10:00 - X: nope', '12/05/2026, 25:00 - X: nope', '12/05/2026, 10:75 - X: nope', '12/05/2026, 10:00 - X: fine'].join('\n'))
  assert.equal(r.invalidDates, 4); assert.deepEqual(r.messages.map((m) => m.text), ['fine'])
  assert.equal(parseChat('29/02/2024, 10:00 - X: leap year ok').messages.length, 1); assert.equal(parseChat('29/02/2026, 10:00 - X: not a leap year').messages.length, 0)
})
test('a UTC offset turns local chat times into the right instant (Mumbai is +330 minutes)', () => assert.equal(parseChat('[12/05/2026, 10:32:15] A: hi', { utcOffsetMinutes: 330 }).messages[0].occurred_at, '2026-05-12T05:02:15.000Z'))
console.log('limits and junk')
test('text that is not a chat export, an empty paste and an oversize paste all say so rather than guess', () => {
  assert.equal(parseChat('hello world, this is not a chat').format, 'unknown'); assert.equal(parseChat('hello').messages.length, 0); assert.ok(parseChat('   ').error); assert.match(parseChat('x'.repeat(MAX_CHARS + 1)).error ?? '', /smaller parts/)
})
test('more than 500 messages are cut off and flagged', () => {
  const big = Array.from({ length: MAX_MESSAGES + 25 }, (_, i) => `[12/05/2026, 10:${String(i % 60).padStart(2, '0')}:00] A: msg ${i}`).join('\n'); const r = parseChat(big); assert.equal(r.messages.length, MAX_MESSAGES); assert.equal(r.truncated, true)
})
console.log('suggestions and summaries')
test('suggested kinds (a SUGGESTION only)', () => {
  const k = (t: string) => suggestKind(t)
  assert.deepEqual(['Can you send the report?', 'Please share the assets', 'let me know when ready', 'Is it live?'].map(k), ['request', 'request', 'request', 'request'])
  assert.deepEqual(['Approved, go ahead', 'sounds good to me'].map(k), ['approval', 'approval']); assert.deepEqual(['<attached: IMG-1.jpg>', 'here is the screenshot', 'photo of the board'].map(k), ['proof', 'proof', 'proof']); assert.equal(k('Live from tomorrow'), 'update')
  assert.equal(k('Please approve this'), 'request', 'a request wins over an approval keyword')
})
test('the stored summary keeps the sender when no party was chosen, and is cut at 2,000 characters', () => {
  assert.deepEqual(formatSummary('Anna', ' hello ', false), { summary: 'Anna: hello', truncated: false }); assert.deepEqual(formatSummary('Anna', ' hello ', true), { summary: 'hello', truncated: false })
  const long = formatSummary('A', 'x'.repeat(3000), true); assert.equal(long.summary.length, 2000); assert.equal(long.truncated, true)
})
test('the duplicate key ignores formatting of the instant and surrounding spaces', () => assert.equal(dedupeKey('2026-05-12T10:32:15Z', 'inbound', ' hi '), dedupeKey('2026-05-12T10:32:15.000Z', 'inbound', 'hi')))
console.log(`\n${passed} passed`)
