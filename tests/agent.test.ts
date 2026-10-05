// Run with: npx tsx tests/agent.test.ts   (no database or network needed)
import assert from 'node:assert/strict'
import { toAgentItemView, toAgentIntelView, agentAvailability, AGENT_ITEM_VIEW_KEYS, AGENT_INTEL_VIEW_KEYS, AGENT_SAFE_ATTRIBUTE_KEYS, type ItemRow, type GrantRow } from '../src/lib/agentView'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name) }

// A deliberately HOSTILE row: every sensitive thing we know of is present, so a leak cannot hide.
const SECRETS = ['SECRET VENDOR', 'SECRET-CONTACT', 'SECRET-OPERATOR', '98765', 'margin-leak', 'SECRET-LEAGUE', 'nested-secret', 'SECRET-ITEMID']
const item: ItemRow = {
  name: 'Perimeter slot', availability: 'available', offer_expiry: '2026-12-01',
  attributes: { asset_type: 'led_perimeter', quantity: 3, cost: 98765, margin_pct: 'margin-leak', vendor_id: 'SECRET-ITEMID', nested: { vendor: 'nested-secret' }, arr: ['SECRET VENDOR'], nothing: null },
  properties: {
    name: 'UAE League', market: 'UAE', event_start: '2026-11-14', event_end: '2026-11-28', categories: { label: 'League and tournament' },
    attributes: { sport: 'cricket', vendor_name: 'SECRET VENDOR', management_contact: 'SECRET-CONTACT', fleet_operator: 'SECRET-OPERATOR', league_name: 'SECRET-LEAGUE', season_year: '2026', gaming_brand_acceptance: 'accepted' }
  }
}
const grant: GrantRow = { id: 'grant-1', display_title: null, indicative_price: null, price_currency: null }

console.log('agent item view')
test('exposes EXACTLY the documented keys — nothing more can appear without this test failing', () => {
  assert.deepEqual(Object.keys(toAgentItemView(grant, item)).sort(), [...AGENT_ITEM_VIEW_KEYS].sort())
})
test('no secret from a hostile input survives anywhere in the output', () => {
  const out = JSON.stringify(toAgentItemView({ ...grant, indicative_price: 5000, price_currency: 'USD' }, item))
  for (const s of SECRETS) assert.ok(!out.includes(s), `leaked: ${s}`)
})
test('only allow-listed attributes come through, only as plain values', () => {
  const v = toAgentItemView(grant, item)
  assert.deepEqual(v.details, { sport: 'cricket', season_year: '2026', gaming_brand_acceptance: 'accepted', asset_type: 'led_perimeter', quantity: 3 })
})
test('the id is the GRANT id, never the internal item id', () => { assert.equal(toAgentItemView(grant, item).id, 'grant-1') })
test('availability: only "available" is shown as available; proposed/sold/on_hold are indistinguishable', () => {
  assert.equal(agentAvailability('available'), 'Available')
  for (const s of ['proposed', 'sold', 'on_hold', 'expired', 'anything']) assert.equal(agentAvailability(s), 'Not currently available')
})
test('title: white-label display_title wins; otherwise "property — item"', () => {
  assert.equal(toAgentItemView({ ...grant, display_title: '  Premium LED package  ' }, item).title, 'Premium LED package')
  assert.equal(toAgentItemView(grant, item).title, 'UAE League — Perimeter slot')
})
test('price appears ONLY if management typed one; never derived from anything', () => {
  assert.equal(toAgentItemView(grant, item).indicative_price, null)
  assert.deepEqual(toAgentItemView({ ...grant, indicative_price: '5000.50', price_currency: 'EUR' }, item).indicative_price, { amount: 5000.5, currency: 'EUR' })
  assert.deepEqual(toAgentItemView({ ...grant, indicative_price: 0 }, item).indicative_price, { amount: 0, currency: 'USD' })
})
test('long text is truncated; empty strings and missing relations are tolerated', () => {
  const long = toAgentItemView(grant, { ...item, attributes: { unit_description: 'x'.repeat(5000), package_type: '   ' }, properties: null })
  assert.equal((long.details.unit_description as string).length, 300); assert.ok(!('package_type' in long.details))
  assert.equal(long.title, 'Perimeter slot'); assert.equal(long.category, null)
})
test('the safe-key list contains no source-identifying names (guards against someone adding one later)', () => {
  for (const bad of ['vendor_name', 'vendor_id', 'vendor', 'management_contact', 'fleet_operator', 'league_name', 'team_name', 'player_name', 'talent_name', 'creator_name', 'channel_name', 'cost', 'margin', 'margin_pct', 'price', 'rate', 'agent', 'agent_cut'])
    assert.ok(!AGENT_SAFE_ATTRIBUTE_KEYS.has(bad), `${bad} must not be agent-visible`)
})

console.log('agent intel view')
test('an agent sees their note and a status, never the reliability, the reviewer or anyone else', () => {
  const v = toAgentIntelView({ id: 'n1', note: 'rate is up', created_at: '2026-01-01', review_status: 'reviewed', claimed_price: '1200.5', claimed_currency: 'USD', ...{ reliability: 'confirmed', reviewed_by: 'SECRET-USER', submitted_by_agent_id: 'SECRET-AGENT' } } as never)
  assert.deepEqual(Object.keys(v).sort(), [...AGENT_INTEL_VIEW_KEYS].sort())
  const out = JSON.stringify(v); assert.ok(!out.includes('confirmed') && !out.includes('SECRET'))
  assert.deepEqual(v.claimed_price, { amount: 1200.5, currency: 'USD' })
})
test('status labels', () => {
  const s = (st: string) => toAgentIntelView({ id: 'x', note: 'n', created_at: 't', review_status: st, claimed_price: null, claimed_currency: null }).status
  assert.equal(s('pending'), 'Submitted'); assert.equal(s('reviewed'), 'Reviewed'); assert.equal(s('rejected'), 'Declined')
})

console.log(`\n${passed} passed`)
