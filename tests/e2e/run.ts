/* eslint-disable @typescript-eslint/no-explicit-any */
// End-to-end: the REAL route handlers -> real supabase-js -> real PostgREST -> real Postgres.
// Only the login lookup is mocked (see mocks/). Needs a running PostgREST; see tests/e2e/README.md.
import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'
import { NextRequest } from 'next/server'

const TEAM = '11111111-0000-0000-0000-000000000001'
const MANAGER = '22222222-0000-0000-0000-000000000002'
const CEO = '33333333-0000-0000-0000-000000000003'
const SPARE_CEO = '55555555-0000-0000-0000-000000000005' // for the "only a CEO can demote a CEO" test — see fixtures.sql
const POSTGREST = process.env.POSTGREST_URL ?? 'http://127.0.0.1:3000'
const SECRET = process.env.JWT_SECRET ?? 'e2e-secret-e2e-secret-e2e-secret-1234'
const PROXY_PORT = 3001

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'service_role', iss: 'e2e' })}`
const serviceJwt = `${unsigned}.${crypto.createHmac('sha256', SECRET).update(unsigned).digest('base64url')}`

process.env.SUPABASE_URL = `http://127.0.0.1:${PROXY_PORT}`
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${PROXY_PORT}`
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'unused'
process.env.SUPABASE_SERVICE_ROLE_KEY = serviceJwt
delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY // Drive is deliberately unconfigured: exercises the "Drive failed, export still works" path
delete process.env.ANTHROPIC_API_KEY

// supabase-js talks to <url>/rest/v1/...; PostgREST serves at /... — this is what Supabase's gateway does.
const proxy = http.createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', async () => {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) if (v && !['host', 'content-length', 'connection'].includes(k)) headers[k] = Array.isArray(v) ? v.join(',') : v
    const body = chunks.length && !['GET', 'HEAD'].includes(req.method!) ? Buffer.concat(chunks) : undefined
    const r = await fetch(POSTGREST + req.url!.replace(/^\/rest\/v1/, ''), { method: req.method, headers, body })
    const out = Buffer.from(await r.arrayBuffer())
    const rh: Record<string, string> = {}
    r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'content-length', 'connection'].includes(k)) rh[k] = v })
    res.writeHead(r.status, rh); res.end(out)
  })
})

type Handler = (req: NextRequest, ctx: { params: any }) => Promise<Response>
const load = async (path: string): Promise<Record<string, Handler>> => import(`../../src/app/api/${path}/route`)

async function call(handler: Handler, o: { as?: string; method?: string; query?: string; body?: unknown; params?: Record<string, string> } = {}) {
  ;(globalThis as any).__TEST_USER__ = o.as ?? null
  const init: any = { method: o.method ?? 'GET' }
  if (o.body !== undefined) { init.body = JSON.stringify(o.body); init.headers = { 'content-type': 'application/json' } }
  const res = await handler(new NextRequest(`http://localhost/api/x${o.query ?? ''}`, init), { params: o.params ?? {} })
  const json = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null
  return { status: res.status, json, res }
}

const failures: string[] = []
let passed = 0
async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log('  ok   ' + name) }
  catch (e: any) { failures.push(`${name}\n         ${String(e.message).split('\n').slice(0, 4).join('\n         ')}`); console.log('  FAIL ' + name) }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.01

async function main() {
  await new Promise<void>((r) => proxy.listen(PROXY_PORT, r))
  const { supabaseService } = await import('../../src/lib/supabaseServer')
  const svc = supabaseService()
  const count = async (table: string, f: Record<string, string | null> = {}) => {
    let q: any = svc.from(table).select('id', { count: 'exact', head: true })
    for (const [k, v] of Object.entries(f)) q = v === null ? q.is(k, null) : q.eq(k, v)
    return (await q).count as number
  }

  const H = {
    vendors: await load('vendors'), brands: await load('brands'), brandById: await load('brands/[id]'), tier: await load('brands/[id]/tier'),
    brandShares: await load('brands/[id]/shares'), groups: await load('brand-groups'), agents: await load('agents'), routes: await load('routes'),
    properties: await load('properties'), items: await load('items'), prices: await load('price-records'), confirm: await load('confirmations'),
    proposals: await load('proposals'), proposal: await load('proposals/[id]'), lines: await load('proposals/[id]/lines'),
    margin: await load('proposals/[id]/lines/[lineId]/margin'), negotiated: await load('proposals/[id]/lines/[lineId]/negotiated-price'),
    lineConfirm: await load('proposals/[id]/lines/[lineId]/confirm'),
    stage: await load('proposals/[id]/stage'), exportH: await load('proposals/[id]/export'), versions: await load('proposals/[id]/versions'),
    conflicts: await load('proposals/[id]/conflicts'), shareOv: await load('proposals/[id]/share-overrides'),
    ovQueue: await load('share-overrides'), ovApprove: await load('share-overrides/[id]/approve'),
    shares: await load('shares'), competitors: await load('competitor-links'), competitorById: await load('competitor-links/[id]'),
    importV: await load('import/vendors'), importI: await load('import/inventory'), overrides: await load('overrides'),
    overrideApprove: await load('overrides/[id]/approve'), scoreChanges: await load('route-score-changes'),
    scoreApprove: await load('route-score-changes/[id]/approve'), intel: await load('intel-notes'), health: await load('health'),
    users: await load('users'), userById: await load('users/[id]'), userDisable: await load('users/[id]/disable'),
    userEnable: await load('users/[id]/enable'), userResetPw: await load('users/[id]/reset-password'), changePw: await load('account/change-password'),
    pipeline: await load('pipeline'), wonLost: await load('analytics/won-lost'), ceoView: await load('ceo-view')
  }

  const S: Record<string, string> = {}

  console.log('\nStage 1 — records')
  await step('Team creates a vendor (createRecord no longer forces a missing created_by column)', async () => {
    const r = await call(H.vendors.POST, { as: TEAM, method: 'POST', body: { name: 'Apex Sports Media', type: 'Recurring', markets: 'UAE' } })
    assert.equal(r.status, 201, JSON.stringify(r.json)); S.vendor = r.json.id
    assert.ok(await count('record_versions', { entity_id: S.vendor }), 'a version row was written')
    assert.ok(await count('audit_events', { entity_id: S.vendor, action: 'drive_folder_failed' }), 'Drive failure was audited, not fatal')
  })
  await step('Manager creates a brand group, four brands, and assigns two to the group', async () => {
    const g = await call(H.groups.POST, { as: MANAGER, method: 'POST', body: { name: 'Blitz Group' } }); assert.equal(g.status, 201); S.group = g.json.id
    for (const n of ['Blitz', 'Spin', 'Kingfish', 'Rival']) {
      const b = await call(H.brands.POST, { as: MANAGER, method: 'POST', body: { name: n } }); assert.equal(b.status, 201, JSON.stringify(b.json)); S[n] = b.json.id
    }
    for (const n of ['Blitz', 'Spin']) {
      const r = await call(H.brandById.PATCH, { as: MANAGER, method: 'PATCH', body: { brand_group_id: S.group }, params: { id: S[n] } }); assert.equal(r.status, 200, JSON.stringify(r.json))
    }
    const list = await call(H.groups.GET, { as: TEAM }); assert.equal(list.json[0].brands.length, 2, 'group lists its two member brands')
  })
  await step('agent + routes (direct, via agent)', async () => {
    const a = await call(H.agents.POST, { as: MANAGER, method: 'POST', body: { name: 'Meridian Sports' } }); assert.equal(a.status, 201, JSON.stringify(a.json)); S.agent = a.json.id
    const mk = async (k: string, body: any) => { const r = await call(H.routes.POST, { as: MANAGER, method: 'POST', body }); assert.equal(r.status, 201, JSON.stringify(r.json)); S[k] = r.json.id }
    await mk('rBlitz', { brand_id: S.Blitz, route_type: 'direct', market: 'UAE' })
    await mk('rBlitzMer', { brand_id: S.Blitz, route_type: 'via_agent', agent_id: S.agent, market: 'UAE' })
    await mk('rSpin', { brand_id: S.Spin, route_type: 'direct', market: 'UAE' })
    await mk('rKing', { brand_id: S.Kingfish, route_type: 'via_agent', agent_id: S.agent, market: 'UAE' })
  })
  await step('Team creates property + item + rack price; first confirmation computes next check date', async () => {
    const p = await call(H.properties.POST, { as: TEAM, method: 'POST', body: { name: 'UAE LED Network', category_key: 'ooh_led', market: 'UAE', vendor_id: S.vendor, attributes: {} } })
    assert.equal(p.status, 201, JSON.stringify(p.json)); S.prop = p.json.id
    const i = await call(H.items.POST, { as: TEAM, method: 'POST', body: { property_id: S.prop, name: 'Perimeter slot' } }); assert.equal(i.status, 201, JSON.stringify(i.json)); S.item = i.json.id
    const pr = await call(H.prices.POST, { as: TEAM, method: 'POST', body: { item_id: S.item, type: 'rack', amount: 42000, currency: 'USD', unit: 'per_match', source: 'Rate card' } })
    assert.equal(pr.status, 201, JSON.stringify(pr.json))
    const c = await call(H.confirm.POST, { as: TEAM, method: 'POST', body: { entity_type: 'item', entity_id: S.item } })
    assert.equal(c.status, 200, JSON.stringify(c.json)); assert.ok(c.json.next_reconfirmation_at)
  })
  await step('Intel with a price creates a market_intel price record (never used as cost)', async () => {
    const r = await call(H.intel.POST, { as: TEAM, method: 'POST', body: { note: 'Competitor pays ~45k', price_amount: 45000, item_id: S.item } })
    assert.equal(r.status, 201, JSON.stringify(r.json)); assert.equal(await count('price_records', { item_id: S.item, type: 'market_intel' }), 1)
  })

  console.log('\nStage 2A — pricing, roles, approval')
  await step('brand tier: Manager sets it, Team is refused', async () => {
    const ok = await call(H.tier.PATCH, { as: MANAGER, method: 'PATCH', body: { tier: 'preferred', margin_band_low: 18, margin_band_high: 24 }, params: { id: S.Blitz } }); assert.equal(ok.status, 200, JSON.stringify(ok.json))
    assert.equal((await call(H.tier.GET, { as: TEAM, params: { id: S.Blitz } })).status, 403)
  })
  await step('Team builds a proposal and adds a line; Team never receives margin, warnings or other brands\' prices', async () => {
    const p = await call(H.proposals.POST, { as: TEAM, method: 'POST', body: { brand_id: S.Blitz, route_id: S.rBlitz, brief: 'LED push', budget: 200000 } }); assert.equal(p.status, 201, JSON.stringify(p.json)); S.prop1 = p.json.id
    const l = await call(H.lines.POST, { as: TEAM, method: 'POST', body: { item_id: S.item, quantity: 3 }, params: { id: S.prop1 } }); assert.equal(l.status, 201, JSON.stringify(l.json)); S.line1 = l.json.id
    assert.equal(l.json.warnings, undefined, 'warnings quote the margin band — D10 says Team must not see them')
    assert.equal(l.json.other_brand_prices, undefined)
    const g = await call(H.proposal.GET, { as: TEAM, params: { id: S.prop1 } })
    assert.equal(g.json.can_view_margin, false); assert.equal(g.json.lines[0].pricing, undefined)
    assert.ok(near(g.json.lines[0].sell_price, 50820), `sell ${g.json.lines[0].sell_price} (cost 42,000 at the 21% band midpoint)`)
    const m = await call(H.proposal.GET, { as: MANAGER, params: { id: S.prop1 } })
    assert.equal(m.json.can_view_margin, true); assert.equal(Number(m.json.lines[0].pricing.cost_used), 42000); assert.equal(Number(m.json.lines[0].pricing.margin_pct), 21)
    assert.ok(m.json.lines[0].warnings.some((w: string) => /market price/i.test(w)), 'Manager sees the above-market warning')
  })
  await step('gate: Team cannot approve; Manager cannot approve until priced; margin needs margin.set', async () => {
    assert.equal((await call(H.stage.PATCH, { as: TEAM, method: 'PATCH', body: { to_stage: 'Approved' }, params: { id: S.prop1 } })).status, 403)
    const blocked = await call(H.stage.PATCH, { as: MANAGER, method: 'PATCH', body: { to_stage: 'Approved' }, params: { id: S.prop1 } })
    assert.equal(blocked.status, 400); assert.match(blocked.json.error, /Not priced at Manager level.*Perimeter slot/)
    assert.equal((await call(H.margin.PATCH, { as: TEAM, method: 'PATCH', body: { rate: 25 }, params: { id: S.prop1, lineId: S.line1 } })).status, 403)
    const set = await call(H.margin.PATCH, { as: MANAGER, method: 'PATCH', body: { rate: 22 }, params: { id: S.prop1, lineId: S.line1 } }); assert.equal(set.status, 200, JSON.stringify(set.json)); assert.ok(near(set.json.sell_price, 51240))
    assert.equal((await call(H.stage.PATCH, { as: MANAGER, method: 'PATCH', body: { to_stage: 'Approved' }, params: { id: S.prop1 } })).status, 200)
    assert.equal(await count('proposal_stage_history', { proposal_id: S.prop1 }), 1)
  })

  console.log('\nStage 2A — export, versions, shares')
  await step('export: refuses before Approved; then returns a real .xlsx, version 1, one share, Drive failure reported not fatal', async () => {
    const early = await call(H.proposals.POST, { as: TEAM, method: 'POST', body: { brand_id: S.Kingfish, route_id: S.rKing } }); S.propK = early.json.id
    assert.equal((await call(H.exportH.POST, { as: TEAM, method: 'POST', params: { id: S.propK } })).status, 400)
    const r = await call(H.exportH.POST, { as: TEAM, method: 'POST', params: { id: S.prop1 } })
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.match(r.res.headers.get('content-type') ?? '', /spreadsheetml/)
    assert.equal(Buffer.from(await r.res.arrayBuffer()).subarray(0, 2).toString(), 'PK', 'a real zip/xlsx container')
    assert.equal(r.res.headers.get('X-Export-Version'), '1'); assert.equal(r.res.headers.get('X-Export-Shares'), '1'); assert.equal(r.res.headers.get('X-Export-Drive'), 'failed')
    const v = await svc.from('proposal_versions').select('snapshot').eq('proposal_id', S.prop1).single()
    assert.ok(!/cost|margin/i.test(JSON.stringify(v.data!.snapshot)), 'version snapshot holds brand-facing data only')
  })
  await step('re-export unchanged: no new version, and same brand + same route is NOT a conflict', async () => {
    const r = await call(H.exportH.POST, { as: TEAM, method: 'POST', params: { id: S.prop1 } })
    assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.res.headers.get('X-Export-Version'), '1')
    assert.equal(await count('shares', { item_id: S.item }), 2)
  })
  await step('negotiated cost: Team can record but not apply (nothing is written if refused); Manager can apply', async () => {
    const before = await count('price_records', { item_id: S.item })
    const refused = await call(H.negotiated.POST, { as: TEAM, method: 'POST', body: { amount: 38000, apply_to_line: true }, params: { id: S.prop1, lineId: S.line1 } })
    assert.equal(refused.status, 403); assert.equal(await count('price_records', { item_id: S.item }), before, 'refused request wrote nothing')
    const rec = await call(H.negotiated.POST, { as: TEAM, method: 'POST', body: { amount: 39000, reusable: false }, params: { id: S.prop1, lineId: S.line1 } }); assert.equal(rec.status, 201, JSON.stringify(rec.json))
    const row = await svc.from('price_records').select('type, brand_id, proposal_id, proposal_line_id, reusable').eq('id', rec.json.price_record_id).single()
    assert.deepEqual(row.data, { type: 'negotiated', brand_id: S.Blitz, proposal_id: S.prop1, proposal_line_id: S.line1, reusable: false })
    const applied = await call(H.negotiated.POST, { as: MANAGER, method: 'POST', body: { amount: 38000, reusable: false, apply_to_line: true }, params: { id: S.prop1, lineId: S.line1 } })
    assert.equal(applied.status, 201, JSON.stringify(applied.json)); assert.ok(near(applied.json.applied.new_sell_price, 46360))
  })
  await step('a non-reusable negotiated rate does NOT become another brand\'s cost', async () => {
    const l = await call(H.lines.POST, { as: TEAM, method: 'POST', body: { item_id: S.item }, params: { id: S.propK } }); assert.equal(l.status, 201, JSON.stringify(l.json))
    const m = await call(H.proposal.GET, { as: MANAGER, params: { id: S.propK } })
    assert.equal(Number(m.json.lines[0].pricing.cost_used), 42000, 'Kingfish gets the rack rate, not Blitz\'s 38,000 negotiated rate')
  })
  await step('export after a price change mints version 2 with a readable change record', async () => {
    const r = await call(H.exportH.POST, { as: TEAM, method: 'POST', params: { id: S.prop1 } }); assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.res.headers.get('X-Export-Version'), '2')
    const v = await call(H.versions.GET, { as: TEAM, params: { id: S.prop1 } })
    assert.equal(v.json.length, 2); assert.match(v.json[0].change_summary, /price .* → .*46,360/)
  })

  console.log('\nStage 2A — share conflicts (Block 4)')
  await step('same brand group: export is blocked (409) and leaves no version or share behind', async () => {
    const p = await call(H.proposals.POST, { as: TEAM, method: 'POST', body: { brand_id: S.Spin, route_id: S.rSpin } }); S.propS = p.json.id
    const l = await call(H.lines.POST, { as: TEAM, method: 'POST', body: { item_id: S.item }, params: { id: S.propS } }); S.lineS = l.json.id
    await call(H.margin.PATCH, { as: MANAGER, method: 'PATCH', body: { rate: 15 }, params: { id: S.propS, lineId: S.lineS } })
    assert.equal((await call(H.stage.PATCH, { as: MANAGER, method: 'PATCH', body: { to_stage: 'Approved' }, params: { id: S.propS } })).status, 200)
    const sharesBefore = await count('shares', { item_id: S.item })
    const r = await call(H.exportH.POST, { as: TEAM, method: 'POST', params: { id: S.propS } })
    assert.equal(r.status, 409, JSON.stringify(r.json)); assert.equal(r.json.conflicts[0].conflicts[0].conflict_type, 'same_brand_group')
    assert.equal(await count('proposal_versions', { proposal_id: S.propS }), 0, 'no version minted'); assert.equal(await count('shares', { item_id: S.item }), sharesBefore)
    const c = await call(H.conflicts.GET, { as: TEAM, params: { id: S.propS } }); assert.equal(c.json[0].override, 'none')
  })
  await step('override: reason required; Team requests -> pending; Team cannot approve; Manager approves; send works once', async () => {
    assert.equal((await call(H.shareOv.POST, { as: TEAM, method: 'POST', body: { reason: '  ' }, params: { id: S.propS } })).status, 400)
    const req = await call(H.shareOv.POST, { as: TEAM, method: 'POST', body: { reason: 'Different territory, brand confirmed' }, params: { id: S.propS } })
    assert.equal(req.status, 201, JSON.stringify(req.json)); assert.equal(req.json.auto_approved, false)
    assert.equal((await call(H.conflicts.GET, { as: TEAM, params: { id: S.propS } })).json[0].override, 'pending')
    assert.equal((await call(H.exportH.POST, { as: TEAM, method: 'POST', params: { id: S.propS } })).status, 409, 'pending is not approved')
    const q = await call(H.ovQueue.GET, { as: TEAM, query: '?status=pending' }); assert.equal(q.status, 200, JSON.stringify(q.json))
    assert.equal(q.json[0].items.name, 'Perimeter slot'); assert.equal(q.json[0].brands.name, 'Spin'); assert.equal(q.json[0].requester.full_name, 'team user')
    S.ov = q.json[0].id
    assert.equal((await call(H.ovApprove.PATCH, { as: TEAM, method: 'PATCH', params: { id: S.ov } })).status, 403)
    assert.equal((await call(H.ovApprove.PATCH, { as: MANAGER, method: 'PATCH', params: { id: S.ov } })).status, 200)
    const ok = await call(H.exportH.POST, { as: TEAM, method: 'POST', params: { id: S.propS } }); assert.equal(ok.status, 200, JSON.stringify(ok.json))
    const share = await svc.from('shares').select('override_id, conflict_summary').eq('item_id', S.item).eq('brand_id', S.Spin).single()
    assert.equal(share.data!.override_id, S.ov); assert.match(share.data!.conflict_summary, /same brand group/)
    assert.equal((await svc.from('share_conflict_overrides').select('status').eq('id', S.ov).single()).data!.status, 'used')
    assert.equal((await call(H.exportH.POST, { as: TEAM, method: 'POST', params: { id: S.propS } })).status, 409, 'an override is single-use')
  })
  await step('Manager\'s own override request is approved on the spot', async () => {
    const r = await call(H.shareOv.POST, { as: MANAGER, method: 'POST', body: { reason: 'Approved by me' }, params: { id: S.propS } })
    assert.equal(r.status, 201, JSON.stringify(r.json)); assert.equal(r.json.auto_approved, true)
  })
  await step('manual share: blocked on conflict (409); allowed but flagged when logged after the fact', async () => {
    const blocked = await call(H.shares.POST, { as: TEAM, method: 'POST', body: { item_id: S.item, brand_id: S.Blitz, route_id: S.rBlitzMer, channel: 'WhatsApp' } })
    assert.equal(blocked.status, 409, JSON.stringify(blocked.json)); assert.ok(blocked.json.conflicts.length)
    const after = await call(H.shares.POST, { as: TEAM, method: 'POST', body: { item_id: S.item, brand_id: S.Blitz, route_id: S.rBlitzMer, channel: 'WhatsApp', logged_after_the_fact: true } })
    assert.equal(after.status, 201, JSON.stringify(after.json)); assert.match(after.json.conflict_summary, /^Logged after the fact/)
  })
  await step('agent\'s other brand: Kingfish via Meridian is flagged because Meridian already holds it for Blitz', async () => {
    const c = await call(H.conflicts.GET, { as: TEAM, params: { id: S.propK } })
    assert.ok(c.json[0].conflicts.some((x: any) => x.conflict_type === 'agent_other_brand'), JSON.stringify(c.json[0].conflicts.map((x: any) => x.conflict_type)))
  })
  await step('competitors (D8): Team refused; Manager adds; reversed duplicate -> 409; delete needs permission', async () => {
    const body = { a_type: 'brand', a_id: S.Blitz, b_type: 'brand', b_id: S.Rival, note: 'Direct rivals' }
    assert.equal((await call(H.competitors.POST, { as: TEAM, method: 'POST', body })).status, 403)
    const ok = await call(H.competitors.POST, { as: MANAGER, method: 'POST', body }); assert.equal(ok.status, 201, JSON.stringify(ok.json))
    assert.equal((await call(H.competitors.POST, { as: MANAGER, method: 'POST', body: { ...body, a_id: S.Rival, b_id: S.Blitz } })).status, 409)
    const list = await call(H.competitors.GET, { as: TEAM }); assert.equal(list.json[0].a_name, 'Blitz'); assert.equal(list.json[0].b_name, 'Rival')
    assert.equal((await call(H.competitorById.DELETE, { as: TEAM, method: 'DELETE', params: { id: ok.json.id } })).status, 403)
    assert.equal((await call(H.competitorById.DELETE, { as: MANAGER, method: 'DELETE', params: { id: ok.json.id } })).status, 200)
  })
  await step('A5: everything already shared with Blitz is listed, newest first, with the route', async () => {
    const r = await call(H.brandShares.GET, { as: TEAM, params: { id: S.Blitz } })
    assert.ok(r.json.length >= 3); assert.equal(r.json[0].item, 'Perimeter slot'); assert.ok(r.json.some((s: any) => s.route === 'via Meridian Sports'))
  })

  console.log('\nAdmin-managed users (permission gates + role logic only — see note below)')
  // NOTE: auth.admin.createUser/updateUserById/deleteUser hit Supabase's Auth (GoTrue) service, which
  // has no equivalent running in this sandbox (only PostgREST does). So account creation, password
  // reset, and disable/enable are NOT exercised here — only the logic that runs before/around them:
  // permission checks (which reject before ever calling auth.admin) and the role-change endpoint
  // (which never calls auth.admin at all). Verify account creation for real on first deploy.
  await step('every user-management endpoint rejects Team before touching auth.admin at all', async () => {
    assert.equal((await call(H.users.POST, { as: TEAM, method: 'POST', body: { full_name: 'X', email: 'x@x.com', role_key: 'team' } })).status, 403)
    assert.equal((await call(H.users.GET, { as: TEAM })).status, 403)
    assert.equal((await call(H.userDisable.PATCH, { as: TEAM, method: 'PATCH', params: { id: MANAGER } })).status, 403)
    assert.equal((await call(H.userEnable.PATCH, { as: TEAM, method: 'PATCH', params: { id: MANAGER } })).status, 403)
    assert.equal((await call(H.userResetPw.POST, { as: TEAM, method: 'POST', params: { id: MANAGER } })).status, 403)
  })
  await step('validation runs before any auth.admin call: bad email, missing name, bad role are all refused', async () => {
    assert.equal((await call(H.users.POST, { as: MANAGER, method: 'POST', body: { full_name: 'X', email: 'not-an-email', role_key: 'team' } })).status, 400)
    assert.equal((await call(H.users.POST, { as: MANAGER, method: 'POST', body: { email: 'x@x.com', role_key: 'team' } })).status, 400)
    assert.equal((await call(H.users.POST, { as: MANAGER, method: 'POST', body: { full_name: 'X', email: 'x@x.com', role_key: 'superadmin' } })).status, 400)
  })
  await step('role changes (no auth.admin involved) — Manager can promote Team, cannot demote a CEO, CEO can', async () => {
    // Seed a profile directly (skipping account creation, which needs real auth) to test the role-change endpoint for real.
    // SPARE_CEO is seeded in fixtures.sql (both auth.users and profiles) specifically for this test —
    // profiles.id has a foreign key to auth.users, which the test client can't insert into itself
    // (PostgREST here only exposes the public schema; see pg.conf's db-schemas setting).
    const seeded = SPARE_CEO
    const byManager = await call(H.userById.PATCH, { as: MANAGER, method: 'PATCH', body: { role_key: 'team' }, params: { id: seeded } })
    assert.equal(byManager.status, 403, 'Manager cannot demote a CEO')
    const byCeo = await call(H.userById.PATCH, { as: CEO, method: 'PATCH', body: { role_key: 'team' }, params: { id: seeded } })
    assert.equal(byCeo.status, 200, JSON.stringify(byCeo.json))
    assert.equal(await count('audit_events', { entity_id: seeded, action: 'user_role_changed' }), 1)
  })
  await step('self password-change also needs no admin permission, just a signed-in session', async () => {
    const refused = await call(H.changePw.POST, { method: 'POST', body: { new_password: 'whatever123' } }) // no 'as' — not signed in
    assert.equal(refused.status, 401, 'unauthenticated is refused, but not because of a permission check')
    const tooShort = await call(H.changePw.POST, { as: TEAM, method: 'POST', body: { new_password: 'short' } })
    assert.equal(tooShort.status, 400)
    // Not asserting 200 here: that final step calls auth.admin.updateUserById, which needs real GoTrue.
  })

  console.log('\nOther guards and workflows')
  await step('currency mismatch is refused when adding a line', async () => {
    const i2 = await call(H.items.POST, { as: TEAM, method: 'POST', body: { property_id: S.prop, name: 'Euro slot' } })
    await call(H.prices.POST, { as: TEAM, method: 'POST', body: { item_id: i2.json.id, type: 'rack', amount: 1000, currency: 'EUR' } })
    const r = await call(H.lines.POST, { as: TEAM, method: 'POST', body: { item_id: i2.json.id }, params: { id: S.prop1 } })
    assert.equal(r.status, 400); assert.match(r.json.error, /EUR.*USD/)
  })
  await step('A26/A30: Sent moves the item to proposed; Won writes a transacted price and sells it; both are idempotent', async () => {
    // A fresh item/proposal, isolated from S.item's messier history elsewhere, so "available -> proposed -> sold" is unambiguous.
    const item = await call(H.items.POST, { as: TEAM, method: 'POST', body: { property_id: S.prop, name: 'A26 test item' } }); S.a26item = item.json.id
    await call(H.prices.POST, { as: TEAM, method: 'POST', body: { item_id: S.a26item, type: 'rack', amount: 10000, currency: 'USD' } })
    const p = await call(H.proposals.POST, { as: TEAM, method: 'POST', body: { brand_id: S.Blitz, route_id: S.rBlitz } }); const propId = p.json.id
    const l = await call(H.lines.POST, { as: TEAM, method: 'POST', body: { item_id: S.a26item }, params: { id: propId } })
    await call(H.margin.PATCH, { as: MANAGER, method: 'PATCH', body: { rate: 20 }, params: { id: propId, lineId: l.json.id } })
    assert.equal((await call(H.stage.PATCH, { as: MANAGER, method: 'PATCH', body: { to_stage: 'Approved' }, params: { id: propId } })).status, 200)

    const beforeSend = await svc.from('items').select('availability').eq('id', S.a26item).single()
    assert.equal(beforeSend.data!.availability, 'available')
    assert.equal((await call(H.stage.PATCH, { as: MANAGER, method: 'PATCH', body: { to_stage: 'Sent' }, params: { id: propId } })).status, 200)
    assert.equal((await svc.from('items').select('availability').eq('id', S.a26item).single()).data!.availability, 'proposed', 'A26: Sent moves it out of available')

    assert.equal((await call(H.stage.PATCH, { as: MANAGER, method: 'PATCH', body: { to_stage: 'Won' }, params: { id: propId } })).status, 200)
    assert.equal((await svc.from('items').select('availability').eq('id', S.a26item).single()).data!.availability, 'sold', 'Won sells it')
    const transacted = await svc.from('price_records').select('amount, brand_id, route_id, proposal_id').eq('item_id', S.a26item).eq('type', 'transacted').single()
    assert.equal(Number(transacted.data!.amount), 10000, 'A30: writes back the COST used (the rack rate), not the margin-adjusted sell price')
    assert.equal(transacted.data!.brand_id, S.Blitz); assert.equal(transacted.data!.proposal_id, propId)

    // Idempotent: calling Won again must not create a second transacted record or error out.
    assert.equal((await call(H.stage.PATCH, { as: MANAGER, method: 'PATCH', body: { to_stage: 'Won' }, params: { id: propId } })).status, 200)
    assert.equal(await count('price_records', { item_id: S.a26item, type: 'transacted' }), 1, 'the unique index prevented a duplicate')

    // This transacted record should now outrank the rack rate as the best valid cost for next time.
    const nextLine = await call(H.lines.POST, { as: TEAM, method: 'POST', body: { item_id: S.a26item }, params: { id: S.propK } })
    assert.equal(nextLine.status, 201, JSON.stringify(nextLine.json))
    const check = await call(H.proposal.GET, { as: MANAGER, params: { id: S.propK } })
    const addedLine = check.json.lines.find((l: { item_id: string }) => l.item_id === S.a26item)
    assert.equal(Number(addedLine.pricing.cost_used), 10000, 'transacted (10,000) still wins here since it equals the rack rate — the real proof is the TYPE used, checked next')
    assert.equal((await svc.from('price_records').select('type').eq('id', (await svc.from('proposal_line_pricing').select('cost_source_price_record_id').eq('proposal_line_id', addedLine.id).single()).data!.cost_source_price_record_id).single()).data!.type, 'transacted', 'bestValidCost chose the transacted record specifically, not the rack record, even though both equal 10,000')
  })
  await step('A27 pipeline: everyone sees value, only margin.view holders see net_margin_pct (D10 again)', async () => {
    const asTeam = await call(H.pipeline.GET, { as: TEAM })
    assert.equal(asTeam.status, 200, JSON.stringify(asTeam.json))
    assert.ok(asTeam.json.length > 0)
    assert.ok(asTeam.json.every((p: { net_margin_pct: number | null }) => p.net_margin_pct === null), 'Team gets value but never net_margin_pct')
    const asManager = await call(H.pipeline.GET, { as: MANAGER })
    const won = asManager.json.find((p: { stage: string; net_margin_pct: number | null }) => p.stage === 'Won')
    assert.ok(won && won.net_margin_pct != null, 'Manager sees net_margin_pct')
  })
  await step('A28 won/lost analysis: shape is correct and a known Won deal shows up under its brand', async () => {
    const r = await call(H.wonLost.GET, { as: TEAM })
    assert.equal(r.status, 200, JSON.stringify(r.json))
    for (const key of ['by_brand', 'by_agent', 'by_market', 'by_category', 'by_reason']) assert.ok(Array.isArray(r.json[key]), `${key} is an array`)
    const blitzRow = r.json.by_brand.find((b: { key: string }) => b.key === 'Blitz')
    assert.ok(blitzRow && blitzRow.won >= 1, 'the A26/A30 Won deal counts toward Blitz')
  })
  await step('A32/A33 CEO view: refused for Team AND Manager (ceo_view.access is CEO-only), works for CEO with all four sections present', async () => {
    assert.equal((await call(H.ceoView.GET, { as: TEAM })).status, 403)
    assert.equal((await call(H.ceoView.GET, { as: MANAGER })).status, 403, 'Manager does not hold ceo_view.access — only CEO does')
    const r = await call(H.ceoView.GET, { as: CEO })
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.ok(r.json.inventory.total_value > 0)
    assert.ok(Array.isArray(r.json.pipeline_by_stage) && r.json.pipeline_by_stage.length > 0)
    assert.ok(Array.isArray(r.json.pricing.signoff_queue))
    assert.ok(Array.isArray(r.json.team.recent_activity) && r.json.team.recent_activity.length > 0)
  })
  await step('A32 sign-off queue: a line Manager priced appears; after CEO confirms it, it drops off', async () => {
    const before = (await call(H.ceoView.GET, { as: CEO })).json.pricing.signoff_queue
    const target = before.find((l: { proposal_id: string }) => l.proposal_id === S.prop1)
    assert.ok(target, 'the Manager-priced line on prop1 is awaiting CEO sign-off')

    const confirmed = await call(H.lineConfirm.PATCH, { as: CEO, method: 'PATCH', body: {}, params: { id: S.prop1, lineId: S.line1 } })
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json))
    assert.equal(confirmed.json.action, 'confirmed')

    const after = (await call(H.ceoView.GET, { as: CEO })).json.pricing.signoff_queue
    assert.ok(!after.some((l: { line_id: string }) => l.line_id === S.line1), 'confirmed line no longer appears in the queue')
  })
  await step('Lost needs a reason; Won creates exactly one deal even if called twice', async () => {
    assert.equal((await call(H.stage.PATCH, { as: MANAGER, method: 'PATCH', body: { to_stage: 'Lost' }, params: { id: S.prop1 } })).status, 400)
    for (let n = 0; n < 2; n++) assert.equal((await call(H.stage.PATCH, { as: MANAGER, method: 'PATCH', body: { to_stage: 'Won' }, params: { id: S.prop1 } })).status, 200)
    assert.equal(await count('deals', { proposal_id: S.prop1 }), 1)
  })
  await step('reconfirmation overrides: shorten is immediate, lengthen waits for a Manager; embeds resolve names', async () => {
    const shorten = await call(H.overrides.POST, { as: TEAM, method: 'POST', body: { entity_type: 'property', entity_id: S.prop, period_days: 20, reason: 'Active campaign', direction: 'shorten' } }); assert.equal(shorten.json.status, 'active')
    const lengthen = await call(H.overrides.POST, { as: TEAM, method: 'POST', body: { entity_type: 'item', entity_id: S.item, period_days: 200, reason: 'Stable', direction: 'lengthen' } }); assert.equal(lengthen.json.status, 'pending')
    const q = await call(H.overrides.GET, { as: MANAGER, query: '?status=pending' }); assert.equal(q.json[0].entity_name, 'Perimeter slot')
    assert.equal((await call(H.overrideApprove.PATCH, { as: TEAM, method: 'PATCH', params: { id: lengthen.json.id } })).status, 403)
    assert.equal((await call(H.overrideApprove.PATCH, { as: MANAGER, method: 'PATCH', params: { id: lengthen.json.id } })).status, 200)
  })
  await step('route scores: Team proposes (pending), Manager approves and the route updates', async () => {
    const p = await call(H.scoreChanges.POST, { as: TEAM, method: 'POST', body: { route_id: S.rBlitz, field: 'strength', new_value: 4 } }); assert.equal(p.json.status, 'pending')
    const q = await call(H.scoreChanges.GET, { as: MANAGER, query: '?status=pending' }); assert.equal(q.status, 200, JSON.stringify(q.json)); assert.equal(q.json[0].routes.brands.name, 'Blitz')
    assert.equal((await call(H.scoreApprove.PATCH, { as: MANAGER, method: 'PATCH', params: { id: q.json[0].id } })).status, 200)
    assert.equal((await svc.from('routes').select('strength').eq('id', S.rBlitz).single()).data!.strength, 4)
  })
  await step('CSV import: vendors (one bad row reported), inventory reuses an existing property on re-run', async () => {
    const v = await call(H.importV.POST, { as: TEAM, method: 'POST', body: { rows: [{ name: 'Import Vendor A' }, { name: 'Import Vendor B', type: 'X' }, { name: '' }] } })
    assert.equal(v.status, 200, JSON.stringify(v.json)); assert.equal(v.json.created, 2); assert.equal(v.json.errors.length, 1)
    const rows = [{ category_key: 'ooh_led', vendor_name: 'Import Vendor A', property_name: 'Imported Property', item_name: 'Slot 1', cost: '5000' }, { category_key: 'ooh_led', vendor_name: 'Import Vendor A', property_name: 'Imported Property', item_name: 'Slot 2' }]
    const a = await call(H.importI.POST, { as: TEAM, method: 'POST', body: { rows } }); assert.equal(a.status, 200, JSON.stringify(a.json)); assert.equal(a.json.itemsCreated, 2); assert.equal(a.json.pricesCreated, 1); assert.deepEqual(a.json.errors, [])
    await call(H.importI.POST, { as: TEAM, method: 'POST', body: { rows } })
    assert.equal(await count('properties', { name: 'Imported Property' }), 1, 'the property was reused, not duplicated')
  })
  await step('the list/embed queries the pages use all resolve against the real schema', async () => {
    const q = async (t: string, cols: string) => { const r = await svc.from(t).select(cols).limit(1); assert.equal(r.error, null, `${t}: ${r.error?.message}`) }
    await q('properties', 'id, name, category_key, market, is_stale, next_reconfirmation_at, vendors(name)')
    await q('routes', 'id, brand_id, route_type, market, strength, reliability, status, brands(name), agents(name)')
    await q('agents', 'id, name, markets, cut_method, cut_pct, fixed_fee'); await q('brand_tier', 'brand_id, tier, margin_band_low, margin_band_high')
    await q('vendors', 'id, name, type, markets, status')
    const list = await call(H.proposals.GET, { as: TEAM }); assert.equal(list.status, 200, JSON.stringify(list.json)); assert.ok(list.json.length >= 3)
  })
  await step('/api/health reports every migration present and no critical env missing', async () => {
    const r = await call(H.health.GET, { as: MANAGER }); assert.equal(r.status, 200, JSON.stringify(r.json))
    const bad = r.json.checks.filter((c: any) => !c.ok); assert.deepEqual(bad, [], JSON.stringify(bad))
    assert.equal(r.json.ready, true); assert.equal(r.json.env.ANTHROPIC_API_KEY, false); assert.equal(r.json.session.role, 'manager')
  })

  proxy.close()
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) { console.log('\nFAILURES:\n' + failures.map((f) => ' - ' + f).join('\n')); process.exit(1) }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
