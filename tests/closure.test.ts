// Run with: npx tsx tests/closure.test.ts   (no database or network needed)
import assert from 'node:assert/strict'
import { closureIssues, closureDecision, type ClosureFacts } from '../src/lib/closure'
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name) }
const clean: ClosureFacts = { hasContract: true, requestsOpen: 0, requestsWaitingOnUs: 0, deliverablesOpen: 0, missedUnresolved: 0, stepsOpen: 0, invoicesOutstanding: 0, proofMissing: 0 }

test('a clean project has no issues', () => assert.deepEqual(closureIssues(clean), []))
test('every kind of open item is reported with its count, most serious first', () => {
  const i = closureIssues({ hasContract: false, requestsOpen: 5, requestsWaitingOnUs: 2, deliverablesOpen: 3, missedUnresolved: 1, stepsOpen: 4, invoicesOutstanding: 1, proofMissing: 2 })
  assert.deepEqual(i.map((x) => [x.code, x.count]), [['waiting_on_us', 2], ['missed_unresolved', 1], ['deliverables_open', 3], ['invoices_outstanding', 1], ['proof_missing', 2], ['waiting_on_them', 3], ['steps_open', 4], ['no_contract', 1]])
  assert.equal(i[0].detail, '2 requests are still waiting on us'); assert.equal(i[1].detail, '1 missed deliverable has no make-good and no invoice adjustment'); assert.equal(i[3].detail, '1 invoice is not fully paid')
})
test('requests waiting on someone else are counted separately from those waiting on us', () => {
  assert.deepEqual(closureIssues({ ...clean, requestsOpen: 3, requestsWaitingOnUs: 3 }).map((x) => x.code), ['waiting_on_us']); assert.deepEqual(closureIssues({ ...clean, requestsOpen: 3, requestsWaitingOnUs: 0 }).map((x) => [x.code, x.count]), [['waiting_on_them', 3]])
})
test('no issues: closing needs nothing, and a note is optional', () => { assert.deepEqual(closureDecision([], undefined, undefined), { ok: true, note: null }); assert.deepEqual(closureDecision([], false, '  all good  '), { ok: true, note: 'all good' }) })
test('with issues: needs a real acknowledgement (boolean true, not "true") AND a reason of at least a few words', () => {
  const issues = closureIssues({ ...clean, deliverablesOpen: 1 })
  assert.equal(closureDecision(issues, undefined, 'Brand agreed to drop it').ok, false)
  for (const ack of ['true', 1, 'yes', null]) assert.equal(closureDecision(issues, ack, 'Brand agreed to drop it').ok, false, String(ack))
  assert.equal(closureDecision(issues, true, '').ok, false); assert.equal(closureDecision(issues, true, '  ok ').ok, false, 'a reason of two letters is not a reason')
  assert.deepEqual(closureDecision(issues, true, ' Brand agreed to drop it '), { ok: true, note: 'Brand agreed to drop it' })
})
test('an over-long note is refused', () => { assert.equal(closureDecision([], true, 'x'.repeat(1001)).ok, false); assert.equal(closureDecision([], true, 'x'.repeat(1000)).ok, true) })
console.log(`\n${passed} passed`)
