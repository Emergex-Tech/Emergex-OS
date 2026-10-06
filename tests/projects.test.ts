// Run with: npx tsx tests/projects.test.ts   (no database or network needed)
import assert from 'node:assert/strict'
import { deliveryPct, statusForQuantity, projectDelivery } from '../src/lib/delivery'
import { templateForCategories, FULL_CATEGORIES, SHORT_CATEGORIES, ruleSatisfied, effectiveStatus, phaseProgress, gateStatus, summariseOpenRequests, waitingOn, type ProjectFacts } from '../src/lib/projects'
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name) }

console.log('delivery % (L9)')
test('per-deliverable %: capped at 100, zero when nothing delivered or planned is invalid', () => {
  assert.equal(deliveryPct(10, 5), 50); assert.equal(deliveryPct(10, 10), 100); assert.equal(deliveryPct(10, 25), 100, 'over-delivery does not earn more than 100%')
  assert.equal(deliveryPct(3, 1), 33.3); assert.equal(deliveryPct(10, 0), 0); assert.equal(deliveryPct(0, 5), 0); assert.equal(deliveryPct(-1, 5), 0); assert.equal(deliveryPct(10, -2), 0)
})
test('project %: every deliverable weighs the same (D13 default), replaced ones are left out, a missed one counts what was actually delivered', () => {
  const s = projectDelivery([
    { status: 'delivered', planned: 4, delivered: 4 }, { status: 'partial', planned: 10, delivered: 5 },
    { status: 'planned', planned: 2, delivered: 0 }, { status: 'missed', planned: 1, delivered: 0 }, { status: 'replaced', planned: 6, delivered: 0 }])
  assert.equal(s.pct, 37.5, '(100 + 50 + 0 + 0) / 4 — the replaced one is not in the denominator'); assert.equal(s.counted, 4); assert.equal(s.replacedExcluded, 1)
  assert.deepEqual([s.delivered, s.partial, s.planned, s.missed], [1, 1, 1, 1])
})
test('a missed deliverable and its make-good are not double-counted', () => {
  const before = projectDelivery([{ status: 'delivered', planned: 1, delivered: 1 }, { status: 'missed', planned: 1, delivered: 0 }])
  const after = projectDelivery([{ status: 'delivered', planned: 1, delivered: 1 }, { status: 'replaced', planned: 1, delivered: 0 }, { status: 'delivered', planned: 1, delivered: 1 }])
  assert.equal(before.pct, 50); assert.equal(after.pct, 100)
})
test('a missed deliverable that was partly delivered counts the part that WAS delivered', () => {
  assert.equal(projectDelivery([{ status: 'missed', planned: 5, delivered: 2 }, { status: 'delivered', planned: 1, delivered: 1 }]).pct, 70, '(40 + 100) ÷ 2')
})
test('nothing to count gives null (not 0% and not 100%)', () => { assert.equal(projectDelivery([]).pct, null); assert.equal(projectDelivery([{ status: 'replaced', planned: 1, delivered: 0 }]).pct, null) })
test('mean is rounded to one decimal', () => { assert.equal(projectDelivery([{ status: 'partial', planned: 3, delivered: 1 }, { status: 'planned', planned: 1, delivered: 0 }, { status: 'planned', planned: 1, delivered: 0 }]).pct, 11.1) })

console.log('status from quantity (L8)')
test('quantity decides the status', () => {
  assert.equal(statusForQuantity(10, 10, 'planned'), 'delivered'); assert.equal(statusForQuantity(10, 12, 'partial'), 'delivered'); assert.equal(statusForQuantity(10, 4, 'planned'), 'partial'); assert.equal(statusForQuantity(10, 0, 'planned'), 'planned')
})
test('going back to zero reopens a delivered/partial one; a MISSED one stays missed; a late delivery moves missed forward', () => {
  assert.equal(statusForQuantity(10, 0, 'delivered'), 'planned'); assert.equal(statusForQuantity(10, 0, 'partial'), 'planned'); assert.equal(statusForQuantity(10, 0, 'missed'), 'missed')
  assert.equal(statusForQuantity(10, 3, 'missed'), 'partial'); assert.equal(statusForQuantity(10, 10, 'missed'), 'delivered')
})
test('a REPLACED deliverable is closed, and bad inputs are refused', () => {
  assert.throws(() => statusForQuantity(10, 5, 'replaced'), /make-good/); assert.throws(() => statusForQuantity(0, 1, 'planned')); assert.throws(() => statusForQuantity(10, -1, 'planned'))
})

console.log('template choice (L3, D14)')
test('every one of the 12 categories maps as the PRD says, and the two lists cover all 12 exactly once', () => {
  for (const k of FULL_CATEGORIES) assert.equal(templateForCategories([k]), 'full', k); for (const k of SHORT_CATEGORIES) assert.equal(templateForCategories([k]), 'short', k)
  assert.equal(new Set([...FULL_CATEGORIES, ...SHORT_CATEGORIES]).size, 12)
})
test('a mixed deal gets Full; an unknown or empty deal gets Full (the safer superset)', () => {
  assert.equal(templateForCategories(['ooh_led', 'team']), 'full'); assert.equal(templateForCategories(['ooh_led', 'influencer_creator']), 'short')
  assert.equal(templateForCategories([]), 'full'); assert.equal(templateForCategories([null, undefined]), 'full'); assert.equal(templateForCategories(['ooh_led', 'made_up']), 'full')
})

console.log('paperwork gate (L6)')
const facts = (o: Partial<ProjectFacts> & { receivables?: Partial<ProjectFacts['receivables']> } = {}): ProjectFacts => ({ contractExists: false, contractFileUploaded: false, ...o, receivables: { total: 0, issued: 0, paid: 0, ...(o.receivables ?? {}) } })
test('each rule reads only the records it should', () => {
  const none = facts()
  for (const r of ['contract_exists', 'contract_file_uploaded', 'billing_schedule_created', 'first_invoice_issued', 'first_invoice_paid', 'all_invoices_paid'] as const) assert.equal(ruleSatisfied(r, none), false, r)
  assert.equal(ruleSatisfied(null, facts({ contractExists: true })), false, 'an item with no rule never ticks itself')
  assert.equal(ruleSatisfied('contract_exists', facts({ contractExists: true })), true); assert.equal(ruleSatisfied('contract_file_uploaded', facts({ contractExists: true })), false)
  assert.equal(ruleSatisfied('billing_schedule_created', facts({ receivables: { total: 3 } })), true); assert.equal(ruleSatisfied('first_invoice_issued', facts({ receivables: { total: 3 } })), false)
  assert.equal(ruleSatisfied('first_invoice_paid', facts({ receivables: { total: 3, issued: 2, paid: 1 } })), true)
  // the NEGATIVE cases are what catch a rule that is too eager: issued is not paid, and a part-paid invoice is not paid
  assert.equal(ruleSatisfied('first_invoice_paid', facts({ receivables: { total: 3, issued: 2, paid: 0 } })), false, 'issued but unpaid')
  assert.equal(ruleSatisfied('first_invoice_issued', facts({ receivables: { total: 3, issued: 0, paid: 0 } })), false, 'drafts are not issued')
  assert.equal(ruleSatisfied('contract_file_uploaded', facts({ contractExists: true, contractFileUploaded: false })), false)
  assert.equal(ruleSatisfied('first_invoice_issued', facts({ receivables: { total: 0, issued: 0, paid: 0 } })), false)
})
test('"all invoices paid" needs at least one invoice AND every one paid', () => {
  assert.equal(ruleSatisfied('all_invoices_paid', facts({ receivables: { total: 0, paid: 0 } })), false, 'no invoices is not "all paid"')
  assert.equal(ruleSatisfied('all_invoices_paid', facts({ receivables: { total: 3, issued: 3, paid: 2 } })), false); assert.equal(ruleSatisfied('all_invoices_paid', facts({ receivables: { total: 3, issued: 3, paid: 3 } })), true)
})
test('a ticked box wins; a satisfied rule ticks it; N/A is never overridden; and it REOPENS if the records change', () => {
  const t = facts({ contractExists: true })
  assert.equal(effectiveStatus({ status: 'open', auto_rule: 'contract_exists' }, t), 'done'); assert.equal(effectiveStatus({ status: 'open', auto_rule: null }, t), 'open')
  assert.equal(effectiveStatus({ status: 'done', auto_rule: null }, t), 'done'); assert.equal(effectiveStatus({ status: 'na', auto_rule: 'contract_exists' }, t), 'na')
  assert.equal(effectiveStatus({ status: 'open', auto_rule: 'contract_exists' }, facts()), 'open')
})
test('phase progress ignores N/A in the denominator; an all-N/A phase is complete; sides are tracked separately', () => {
  const p = phaseProgress([
    { phase_no: 1, phase_name: 'P1', side: 'brand', status: 'done' }, { phase_no: 1, phase_name: 'P1', side: 'brand', status: 'open' },
    { phase_no: 1, phase_name: 'P1', side: 'team', status: 'na' }, { phase_no: 1, phase_name: 'P1', side: 'team', status: 'done' }, { phase_no: 2, phase_name: 'P2', side: 'team', status: 'na' }])
  assert.deepEqual([p[0].total, p[0].done, p[0].na, p[0].pct], [4, 2, 1, 67]); assert.deepEqual(p[0].brand, { total: 2, done: 1, na: 0 }); assert.deepEqual(p[0].team, { total: 2, done: 1, na: 1 }); assert.equal(p[1].pct, 100)
})
test('the commercial gate is cleared per side, and "overall" needs neither side open', () => {
  const g = (b: string, t: string) => gateStatus(phaseProgress([{ phase_no: 1, phase_name: 'x', side: 'brand', status: b as never }, { phase_no: 1, phase_name: 'x', side: 'team', status: t as never }]).find((p) => p.phase_no === 1))
  assert.deepEqual(g('done', 'done'), { brand: 'cleared', team: 'cleared', overall: 'cleared' }); assert.deepEqual(g('done', 'open'), { brand: 'cleared', team: 'open', overall: 'open' })
  assert.deepEqual(g('na', 'done'), { brand: 'none', team: 'cleared', overall: 'cleared' }); assert.deepEqual(gateStatus(undefined), { brand: 'none', team: 'none', overall: 'cleared' })
})

console.log('open requests (L29)')
test('who is waiting on whom: outbound requests wait on THEM, inbound on US; only open requests count', () => {
  assert.equal(waitingOn('outbound'), 'them'); assert.equal(waitingOn('inbound'), 'us')
  const now = Date.parse('2026-06-10T00:00:00Z')
  const s = summariseOpenRequests([
    { id: '1', status: 'open', waiting_on: 'them', party_id: 'A', occurred_at: '2026-06-05T00:00:00Z', kind: 'request' }, { id: '2', status: 'open', waiting_on: 'us', party_id: 'A', occurred_at: '2026-06-09T00:00:00Z', kind: 'request' },
    { id: '3', status: 'open', waiting_on: 'us', party_id: null, occurred_at: '2026-06-08T00:00:00Z', kind: 'request' }, { id: '4', status: 'done', waiting_on: null, party_id: 'A', occurred_at: '2026-01-01T00:00:00Z', kind: 'request' },
    { id: '5', status: 'done', waiting_on: null, party_id: 'B', occurred_at: '2026-06-01T00:00:00Z', kind: 'update' }], now)
  assert.deepEqual([s.total, s.onUs, s.onThem, s.oldestDays], [3, 2, 1, 5]); assert.deepEqual(s.byParty, { A: { onUs: 1, onThem: 1 }, '(no party)': { onUs: 1, onThem: 0 } })
  assert.deepEqual(summariseOpenRequests([], now), { total: 0, onUs: 0, onThem: 0, oldestDays: null, byParty: {} })
})
console.log(`\n${passed} passed`)
