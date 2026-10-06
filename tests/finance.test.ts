// Run with: npx tsx tests/finance.test.ts   (no database or network needed)
import assert from 'node:assert/strict'
import { toCents, buildSchedule, addMonths, paymentSummary, isOverdue, needsChase, buildPayables, csvCell, toCsv, invoiceNumber, isValidIsoDate } from '../src/lib/billing'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name) }

console.log('cents + dates')
test('toCents rounds float noise correctly', () => { assert.equal(toCents(59270.4), 5927040); assert.equal(toCents('0.1') + toCents('0.2'), toCents('0.3')) })
test('isValidIsoDate rejects impossible dates', () => { assert.ok(isValidIsoDate('2020-02-29')); assert.ok(!isValidIsoDate('2021-02-29')); assert.ok(!isValidIsoDate('2021-13-01')); assert.ok(!isValidIsoDate('01/02/2021')) })
test('addMonths clamps to month end, leap years and year rollover', () => {
  assert.equal(addMonths('2020-01-31', 1), '2020-02-29'); assert.equal(addMonths('2021-01-31', 1), '2021-02-28')
  assert.equal(addMonths('2020-01-31', 2), '2020-03-31'); assert.equal(addMonths('2020-11-30', 3), '2021-02-28'); assert.equal(addMonths('2020-12-15', 1), '2021-01-15')
})

console.log('billing schedule (B6)')
test('even split', () => { const s = buildSchedule({ totalCents: 1_200_000, installments: 3, firstDueDate: '2020-01-31', intervalMonths: 1 }); assert.deepEqual(s.map((i) => i.amountCents), [400_000, 400_000, 400_000]) })
test('due dates stay on month-ends because each is computed from the FIRST date', () => {
  assert.deepEqual(buildSchedule({ totalCents: 3000, installments: 3, firstDueDate: '2020-01-31', intervalMonths: 1 }).map((i) => i.dueDate), ['2020-01-31', '2020-02-29', '2020-03-31'])
})
test('leftover cents go on the last instalment', () => { assert.deepEqual(buildSchedule({ totalCents: 1_000_001, installments: 3, firstDueDate: '2026-01-01', intervalMonths: 1 }).map((i) => i.amountCents), [333_333, 333_333, 333_335]) })
test('property: for 2,000 random totals/splits the instalments ALWAYS sum to the total, none negative', () => {
  let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let n = 0; n < 2000; n++) {
    const installments = 1 + Math.floor(rnd() * 24); const total = installments + Math.floor(rnd() * 5_000_000)
    const s = buildSchedule({ totalCents: total, installments, firstDueDate: '2026-01-31', intervalMonths: 1 + Math.floor(rnd() * 6) })
    assert.equal(s.reduce((a, i) => a + i.amountCents, 0), total); assert.ok(s.every((i) => i.amountCents > 0))
  }
})
test('rejects bad input', () => {
  const ok = { totalCents: 1000, installments: 2, firstDueDate: '2026-01-01', intervalMonths: 1 }
  assert.throws(() => buildSchedule({ ...ok, installments: 0 })); assert.throws(() => buildSchedule({ ...ok, installments: 61 }))
  assert.throws(() => buildSchedule({ ...ok, installments: 1.5 })); assert.throws(() => buildSchedule({ ...ok, intervalMonths: 0 }))
  assert.throws(() => buildSchedule({ ...ok, firstDueDate: '2026-02-30' })); assert.throws(() => buildSchedule({ ...ok, totalCents: 0 }))
  assert.throws(() => buildSchedule({ ...ok, totalCents: 1, installments: 2 }), /too small/)
})

console.log('payments, overdue, chasing (B9, B10)')
test('payment status', () => { assert.equal(paymentSummary(1000, 0).status, 'unpaid'); assert.equal(paymentSummary(1000, 400).status, 'part_paid'); assert.equal(paymentSummary(1000, 1000).status, 'paid'); assert.equal(paymentSummary(1000, 400).balanceCents, 600) })
test('overdue only when issued, unpaid balance, and past due', () => {
  const t = '2026-06-10'
  assert.ok(isOverdue({ status: 'issued', dueDate: '2026-06-09', balanceCents: 1 }, t))
  assert.ok(!isOverdue({ status: 'issued', dueDate: '2026-06-10', balanceCents: 1 }, t), 'due today is not overdue yet')
  assert.ok(!isOverdue({ status: 'issued', dueDate: '2026-06-01', balanceCents: 0 }, t), 'fully paid')
  assert.ok(!isOverdue({ status: 'draft', dueDate: '2026-06-01', balanceCents: 5 }, t)); assert.ok(!isOverdue({ status: 'void', dueDate: '2026-06-01', balanceCents: 5 }, t))
  assert.ok(!isOverdue({ status: 'issued', dueDate: null, balanceCents: 5 }, t))
})
test('chase reminder: never chased, or 7+ days since', () => {
  assert.ok(needsChase(null, '2026-06-10')); assert.ok(!needsChase('2026-06-05T10:00:00Z', '2026-06-10')); assert.ok(needsChase('2026-06-03T10:00:00Z', '2026-06-10')); assert.ok(!needsChase('2026-06-10T01:00:00Z', '2026-06-10'))
})
test('invoice numbers', () => { assert.equal(invoiceNumber('receivable', 7), 'INV-00007'); assert.equal(invoiceNumber('payable', 123), 'BILL-00123') })

console.log('payables (B8)')
const agent = (m: string, fee = 0) => ({ id: 'ag1', name: 'Meridian', cutMethod: m, fixedFee: fee })
test('one payable per vendor, summing cost × quantity', () => {
  const r = buildPayables([
    { vendorId: 'v1', vendorName: 'Apex', quantity: 3, costUsed: 42000, agentCutAmount: 0 },
    { vendorId: 'v1', vendorName: 'Apex', quantity: 1, costUsed: 1000, agentCutAmount: 0 },
    { vendorId: 'v2', vendorName: 'Pitchside', quantity: 2, costUsed: 500.5, agentCutAmount: 0 }], null)
  assert.deepEqual(r.payables.map((p) => [p.counterpartyName, p.amountCents]), [['Apex', 12_700_000], ['Pitchside', 100_100]]); assert.equal(r.unassignedLines, 0)
})
test('agent commission is summed per unit × quantity for on-top/out-of', () => {
  const r = buildPayables([{ vendorId: 'v1', vendorName: 'A', quantity: 2, costUsed: 100, agentCutAmount: 14.4 }], agent('onTop'))
  assert.deepEqual(r.payables.map((p) => [p.counterpartyType, p.amountCents]), [['vendor', 20_000], ['agent', 2_880]])
})
test('a FIXED-FEE agent is paid the fee once, not once per line', () => {
  const lines = [1, 2, 3].map(() => ({ vendorId: 'v1', vendorName: 'A', quantity: 1, costUsed: 100, agentCutAmount: 500 }))
  const r = buildPayables(lines, agent('fixedFee', 500))
  assert.equal(r.payables.filter((p) => p.counterpartyType === 'agent').length, 1); assert.equal(r.payables.find((p) => p.counterpartyType === 'agent')!.amountCents, 50_000)
})
test('no agent payable for method none, no agent, or a zero cut', () => {
  const l = [{ vendorId: 'v1', vendorName: 'A', quantity: 1, costUsed: 100, agentCutAmount: 0 }]
  assert.equal(buildPayables(l, agent('none')).payables.length, 1); assert.equal(buildPayables(l, null).payables.length, 1); assert.equal(buildPayables(l, agent('onTop')).payables.length, 1)
})
test('lines with no vendor are grouped as "Unassigned vendor" and counted, not dropped', () => {
  const r = buildPayables([{ vendorId: null, vendorName: null, quantity: 1, costUsed: 250, agentCutAmount: 0 }], null)
  assert.equal(r.payables[0].counterpartyName, 'Unassigned vendor'); assert.equal(r.payables[0].counterpartyId, null); assert.equal(r.unassignedLines, 1)
})

console.log('CSV export (B11)')
test('quotes fields with commas, quotes and newlines', () => { assert.equal(csvCell('Smith, John'), '"Smith, John"'); assert.equal(csvCell('say "hi"'), '"say ""hi"""'); assert.equal(csvCell('a\nb'), '"a\nb"') })
test('neutralises spreadsheet formula injection in TEXT cells, leaves numbers alone', () => {
  assert.equal(csvCell('=HYPERLINK("http://evil")'), `"'=HYPERLINK(""http://evil"")"`); assert.equal(csvCell('+1'), "'+1"); assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)"); assert.equal(csvCell('-cmd'), "'-cmd")
  assert.equal(csvCell(-5), '-5'); assert.equal(csvCell(1234.5), '1234.5'); assert.equal(csvCell(null), '')
})
test('toCsv writes a header and CRLF rows', () => { assert.equal(toCsv([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], [{ a: 1, b: 'x,y' }]), 'A,B\r\n1,"x,y"\r\n') })

console.log(`\n${passed} passed`)
