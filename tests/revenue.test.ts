// Run with: npx tsx tests/revenue.test.ts   (no database or network needed)
import assert from 'node:assert/strict'
import { monthsBetween, defaultRange, isMonth, revenueByMonth, marginByDimension, reconciliation, weightedForecast, variance, DEFAULT_WEIGHTS, type RevDeal, type RevInvoice, type RevPayment } from '../src/lib/revenue'
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name) }
const line = (revenue: number, cost: number | null, agentCut: number | null, category = 'team', market = 'UAE', vendor = 'Apex') => ({ revenue, cost, agentCut, category, market, vendor })
const deals: RevDeal[] = [
  { contractId: 'c1', currency: 'USD', bookedOn: '2026-01-15', finalAmount: 1000, brand: 'Blitz', agent: 'Meridian', owner: 'Asha', lines: [line(600, 400, 60), line(400, 300, 40, 'ooh_led', 'UK', 'Pitch')] },
  { contractId: 'c2', currency: 'USD', bookedOn: '2026-01-31', finalAmount: 500, brand: 'Blitz', agent: null, owner: 'Ravi', lines: [line(500, 350, null)] },
  { contractId: 'c3', currency: 'USD', bookedOn: '2026-03-01', finalAmount: 2000, brand: 'Nova', agent: null, owner: 'Asha', lines: [line(2000, null, null)] },          // entered as already running: cost unknown
  { contractId: 'c4', currency: 'AED', bookedOn: '2026-01-10', finalAmount: 9000, brand: 'Blitz', agent: null, owner: 'Asha', lines: [line(9000, 6000, 0)] }]
const inv = (id: string, amount: number, issueDate: string | null, status: RevInvoice['status'] = 'issued', direction: RevInvoice['direction'] = 'receivable', currency = 'USD'): RevInvoice => ({ id, direction, status, amount, currency, issueDate })
const invoices = [inv('i1', 400, '2026-01-20'), inv('i2', 600, '2026-02-05'), inv('i3', 300, null, 'draft'), inv('i4', 250, '2026-02-10', 'void'), inv('i5', 700, '2026-02-01', 'issued', 'payable'), inv('i6', 5000, '2026-01-12', 'issued', 'receivable', 'AED')]
const payments: RevPayment[] = [{ invoiceId: 'i1', amount: 400, paidOn: '2026-02-02' }, { invoiceId: 'i2', amount: 150, paidOn: '2026-02-20' }, { invoiceId: 'i4', amount: 250, paidOn: '2026-02-11' }, { invoiceId: 'i5', amount: 700, paidOn: '2026-02-03' }, { invoiceId: 'i6', amount: 5000, paidOn: '2026-01-30' }]
const Q1 = ['2026-01', '2026-02', '2026-03']

console.log('periods')
test('months between two months, across a year end; a backwards range is empty; the default is the last 12 months', () => {
  assert.deepEqual(monthsBetween('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']); assert.deepEqual(monthsBetween('2026-03', '2026-03'), ['2026-03']); assert.deepEqual(monthsBetween('2026-05', '2026-03'), [])
  assert.deepEqual(defaultRange('2026-11-15'), { from: '2025-12', to: '2026-11' }); assert.deepEqual(defaultRange('2026-01-01'), { from: '2025-02', to: '2026-01' }); assert.equal(monthsBetween('2025-12', '2026-11').length, 12)
  for (const ok of ['2026-01', '2026-12']) assert.ok(isMonth(ok)); for (const bad of ['2026-13', '2026-00', '2026-1', '26-01', '2026-01-01', '', null, 202601]) assert.equal(isMonth(bad), false, String(bad))
})

console.log('booked / invoiced / collected')
test('booked is the contract in the month it was SIGNED; another currency is never mixed in', () => {
  const r = revenueByMonth(deals, invoices, payments, 'USD', Q1); assert.deepEqual(r.months.map((m) => m.booked), [1500, 0, 2000], 'January: 1,000 + 500; the 9,000 is AED'); assert.equal(r.totals.booked, 3500)
  assert.deepEqual(revenueByMonth(deals, invoices, payments, 'AED', Q1).months.map((m) => [m.booked, m.invoiced, m.collected]), [[9000, 5000, 5000], [0, 0, 0], [0, 0, 0]])
})
test('invoiced counts ISSUED receivables only — not drafts, not voided invoices, not what WE owe', () => {
  const r = revenueByMonth(deals, invoices, payments, 'USD', Q1); assert.deepEqual(r.months.map((m) => m.invoiced), [400, 600, 0], 'the draft 300, the voided 250 and the payable 700 are not revenue'); assert.equal(r.totals.invoiced, 1000)
})
test('collected is money actually received, in the month it arrived — never a payment on a voided invoice or a payment WE made', () => {
  const r = revenueByMonth(deals, invoices, payments, 'USD', Q1); assert.deepEqual(r.months.map((m) => m.collected), [0, 550, 0], '400 + 150 in February; the 250 on a voided invoice and the 700 paid to a vendor are not collections'); assert.equal(r.outstanding, 450, '1,000 issued − 550 collected')
})
test('outstanding is as of NOW, not just the months shown; an empty range still reports it', () => {
  const r = revenueByMonth(deals, invoices, payments, 'USD', ['2026-03']); assert.deepEqual([r.totals.invoiced, r.totals.collected, r.outstanding], [0, 0, 450]); assert.deepEqual(revenueByMonth([], [], [], 'USD', Q1).totals, { booked: 0, invoiced: 0, collected: 0 })
})

console.log('margin by dimension')
test('gross = revenue − vendor cost; net = gross − the agent\'s cut; percentages over revenue', () => {
  const b = marginByDimension(deals, 'USD', 'brand'); const blitz = b.find((x) => x.key === 'Blitz')!
  assert.deepEqual([blitz.revenue, blitz.cost, blitz.gross, blitz.net, blitz.gross_pct, blitz.net_pct, blitz.deals], [1500, 1050, 450, 350, 30, 23.3, 2], 'revenue 600+400+500; cost 400+300+350; cuts 60+40+0')
})
test('a deal whose cost is UNKNOWN counts as revenue but never as margin — and is shown separately, not guessed', () => {
  const nova = marginByDimension(deals, 'USD', 'brand').find((x) => x.key === 'Nova')!; assert.deepEqual([nova.revenue, nova.cost, nova.gross, nova.net, nova.gross_pct, nova.net_pct, nova.unknown_cost_revenue], [2000, 0, 0, 0, null, null, 2000])
  const asha = marginByDimension(deals, 'USD', 'owner').find((x) => x.key === 'Asha')!; assert.deepEqual([asha.revenue, asha.unknown_cost_revenue, asha.gross, asha.gross_pct], [3000, 2000, 300, 30], 'her 30% is over the 1,000 whose cost is known — not diluted to 10% by the 2,000 whose cost is not')
})
test('line-level dimensions (category, market, vendor) split ONE deal across its lines; deal-level ones do not', () => {
  assert.deepEqual(marginByDimension(deals, 'USD', 'category').map((x) => [x.key, x.revenue, x.gross, x.deals]), [['team', 3100, 350, 3], ['ooh_led', 400, 100, 1]])
  assert.deepEqual(marginByDimension(deals, 'USD', 'market').map((x) => [x.key, x.revenue]), [['UAE', 3100], ['UK', 400]]); assert.deepEqual(marginByDimension(deals, 'USD', 'vendor').map((x) => [x.key, x.net]), [['Apex', 290], ['Pitch', 60]])
  assert.deepEqual(marginByDimension(deals, 'USD', 'agent').map((x) => [x.key, x.revenue, x.net]), [['(not set)', 2500, 150], ['Meridian', 1000, 200]], 'deals with no agent are grouped, not dropped')
})
test('a period limits margin to deals SIGNED in it; rows are largest revenue first', () => {
  assert.deepEqual(marginByDimension(deals, 'USD', 'brand', ['2026-01']).map((x) => [x.key, x.revenue]), [['Blitz', 1500]]); assert.deepEqual(marginByDimension(deals, 'USD', 'brand').map((x) => x.key), ['Nova', 'Blitz']); assert.deepEqual(marginByDimension(deals, 'EUR', 'brand'), [])
})
test('a contract whose value no longer equals its lines is reported, not silently averaged away', () => {
  assert.deepEqual(reconciliation(deals, 'USD'), []); const drift = [{ ...deals[0], finalAmount: 1200 }, deals[1]]; assert.deepEqual(reconciliation(drift, 'USD'), [{ contractId: 'c1', brand: 'Blitz', contract: 1200, lines: 1000 }])
})

console.log('forecast and variance')
const open = [{ stage: 'Draft', currency: 'USD', value: 1000, estimated: true }, { stage: 'Sent', currency: 'USD', value: 4000, estimated: false }, { stage: 'Sent', currency: 'USD', value: 2000, estimated: false }, { stage: 'Negotiating', currency: 'USD', value: 10000, estimated: false }, { stage: 'Sent', currency: 'AED', value: 99999, estimated: false }, { stage: 'Won', currency: 'USD', value: 5000, estimated: false }]
test('the pipeline is weighted by stage; won and lost proposals and other currencies are not forecast', () => {
  const f = weightedForecast(open, DEFAULT_WEIGHTS, 'USD'); assert.deepEqual(f.stages.map((s) => [s.stage, s.count, s.value, s.weight_pct, s.weighted]), [['Draft', 1, 1000, 10, 100], ['Review', 0, 0, 20, 0], ['Approved', 0, 0, 35, 0], ['Sent', 2, 6000, 50, 3000], ['Negotiating', 1, 10000, 75, 7500]])
  assert.deepEqual(f.total, { count: 4, value: 17000, weighted: 10600, estimated: 1 })
})
test('custom weights replace the defaults stage by stage; a missing stage falls back to its default', () => {
  const f = weightedForecast(open, { Sent: 80, Negotiating: 100 }, 'USD'); assert.deepEqual(f.stages.map((s) => s.weighted), [100, 0, 0, 4800, 10000]); assert.equal(f.total.weighted, 14900)
})
test('variance: actual against plan per month; a month with NO plan shows no variance rather than a false one', () => {
  const m = revenueByMonth(deals, invoices, payments, 'USD', Q1).months; const v = variance(m, [{ period: '2026-01', booked_target: 2000, collected_target: 100 }, { period: '2026-03', booked_target: 1000, collected_target: null }])
  assert.deepEqual(v.map((x) => [x.month, x.plan_booked, x.booked_variance, x.booked_pct, x.plan_collected, x.collected_variance]), [['2026-01', 2000, -500, 75, 100, -100], ['2026-02', null, null, null, null, null], ['2026-03', 1000, 1000, 200, null, null]])
  assert.equal(variance(m, [{ period: '2026-01', booked_target: 0, collected_target: null }])[0].booked_pct, null, 'a zero target has no percentage')
})
console.log(`\n${passed} passed`)
