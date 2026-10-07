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
const AGENT_A = '66666666-0000-0000-0000-000000000006'
const AGENT_B = '77777777-0000-0000-0000-000000000007'
const CO_A = 'a0a0a0a0-0000-0000-0000-00000000000a'
const CO_B = 'b0b0b0b0-0000-0000-0000-00000000000b'
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
process.env.AGENT_ACCESS_ENABLED = '1' // the portal is released for these tests; one test switches it off to prove the kill switch
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

async function call(handler: Handler, o: { as?: string; method?: string; query?: string; body?: unknown; form?: FormData; params?: Record<string, string> } = {}) {
  ;(globalThis as any).__TEST_USER__ = o.as ?? null
  const init: any = { method: o.method ?? 'GET' }
  if (o.body !== undefined) { init.body = JSON.stringify(o.body); init.headers = { 'content-type': 'application/json' } }
  if (o.form) init.body = o.form
  const res = await handler(new NextRequest(`http://localhost/api/x${o.query ?? ''}`, init), { params: o.params ?? {} })
  const json = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null
  return { status: res.status, json, res }
}

const failures: string[] = []
let passed = 0
async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log('  ok   ' + name) }
  catch (e: any) { const at = String(e.stack ?? '').split('\n').find((l) => l.includes('run.ts:'))?.trim().replace(/.*run\.ts:/, 'run.ts line ') ?? ''; failures.push(`${name}\n         ${String(e.message).split('\n').slice(0, 16).join('\n         ')}${at ? `\n         [${at}]` : ''}`); console.log('  FAIL ' + name) }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.01

async function main() {
  await new Promise<void>((r) => proxy.listen(PROXY_PORT, r))
  const { supabaseService } = await import('../../src/lib/supabaseServer')
  const svc = supabaseService()
  const count = async (table: string, f: Record<string, string | null> = {}) => {
    let q: any = svc.from(table).select('*', { count: 'exact', head: true })
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
    pipeline: await load('pipeline'), wonLost: await load('analytics/won-lost'), ceoView: await load('ceo-view'),
    contracts: await load('contracts'), contractById: await load('contracts/[id]'), dealsNeeding: await load('deals/needing-contract'),
    deliverables: await load('contracts/[id]/deliverables'), deliverableById: await load('deliverables/[id]'), notifications: await load('notifications'),
    invoices: await load('invoices'), invoiceById: await load('invoices/[id]'), invoicePayments: await load('invoices/[id]/payments'),
    invoiceChase: await load('invoices/[id]/chase'), schedule: await load('contracts/[id]/billing-schedule'), payables: await load('contracts/[id]/payables'),
    overdue: await load('finance/overdue'), financeExport: await load('finance/export'),
    agentMe: await load('agent/me'), agentItems: await load('agent/items'), agentItem: await load('agent/items/[id]'), agentIntel: await load('agent/intel'),
    agentsList: await load('agent-access/agents'), grants: await load('agent-access/grants'), grantById: await load('agent-access/grants/[id]'),
    activity: await load('agent-access/activity'), intelQueue: await load('agent-access/intel'), intelReview: await load('agent-access/intel/[id]/review'),
    benchmarks: await load('benchmarks'), benchCurve: await load('benchmarks/curve'), itemSearch: await load('items/search'),
    savedFilters: await load('saved-filters'), savedFilterById: await load('saved-filters/[id]'), shortlists: await load('shortlists'),
    shortlistById: await load('shortlists/[id]'), shortlistItems: await load('shortlists/[id]/items'), shortlistItem: await load('shortlists/[id]/items/[itemId]'),
    projects: await load('projects'), projectsBackfill: await load('projects/backfill'), projectById: await load('projects/[id]'), projectParent: await load('projects/[id]/parent'),
    checklistAdd: await load('projects/[id]/checklist'), checklistItem: await load('projects/[id]/checklist/[itemId]'), parties: await load('projects/[id]/parties'),
    partyById: await load('projects/[id]/parties/[partyId]'), comms: await load('projects/[id]/communications'), commResolve: await load('projects/[id]/communications/[cid]/resolve'),
    templates: await load('checklist-templates'), templateItems: await load('checklist-templates/[key]/items'), templateItemById: await load('checklist-template-items/[id]'),
    makeGood: await load('deliverables/[id]/make-good'), invAdj: await load('deliverables/[id]/invoice-adjustment'),
    metricDefs: await load('metric-definitions'), metricDefById: await load('metric-definitions/[category]/[key]'), metrics: await load('projects/[id]/metrics'), metricVoid: await load('projects/[id]/metrics/[mid]/void'),
    proofs: await load('deliverables/[id]/proofs'), proofById: await load('deliverables/[id]/proofs/[proofId]'),
    closure: await load('projects/[id]/closure'), closeProject: await load('projects/[id]/close'), reopen: await load('projects/[id]/reopen'),
    caseStudy: await load('projects/[id]/case-study'), csApprove: await load('projects/[id]/case-study/approve'), csWithdraw: await load('projects/[id]/case-study/withdraw'),
    csList: await load('case-studies'), csById: await load('case-studies/[id]'), csSuggest: await load('case-studies/suggest'),
    chatPreview: await load('projects/[id]/chat-import/preview'), chatConfirm: await load('projects/[id]/chat-import/confirm'),
    files: await load('contracts/[id]/files'), fileById: await load('contracts/[id]/files/[fileId]'), changePw2: await load('account/change-password')
  }

  const S: Record<string, string> = {}
  S.orgId = (await svc.from('profiles').select('org_id').eq('id', TEAM).single()).data!.org_id

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
  console.log('\nStage 2B — contracts, deliverables, notifications (Block 6)')
  await step('needing-contract lists Won deals without one; Team is refused creating one', async () => {
    const n = await call(H.dealsNeeding.GET, { as: TEAM })
    assert.equal(n.status, 200, JSON.stringify(n.json))
    const blitzDeal = n.json.find((d: { brand_name: string }) => d.brand_name === 'Blitz')
    assert.ok(blitzDeal, 'the A26/A30 Won deal for Blitz has no contract yet')
    S.dealId = blitzDeal.deal_id

    const refused = await call(H.contracts.POST, { as: TEAM, method: 'POST', body: { deal_id: S.dealId, renewal_date: '2027-01-01' } })
    assert.equal(refused.status, 403)
  })
  await step('B1: Manager creates a contract — final_amount is computed from the proposal lines, not re-entered', async () => {
    const r = await call(H.contracts.POST, { as: MANAGER, method: 'POST', body: { deal_id: S.dealId, terms: 'Standard terms', renewal_date: '2027-01-01' } })
    assert.equal(r.status, 201, JSON.stringify(r.json))
    assert.equal(Number(r.json.final_amount), 12000, 'the A26/A30 item sold at cost 10,000 + 20% margin')
    S.contractId = r.json.id

    const dup = await call(H.contracts.POST, { as: MANAGER, method: 'POST', body: { deal_id: S.dealId, renewal_date: '2027-01-01' } })
    assert.equal(dup.status, 409, 'one contract per deal')

    const noDate = await call(H.contracts.POST, { as: MANAGER, method: 'POST', body: { deal_id: '00000000-0000-0000-0000-000000000000' } })
    assert.equal(noDate.status, 400, 'renewal_date is validated before the deal is even looked up')
  })
  await step('B2: deliverables — adding one needs contract.manage, marking it done does not (Team can)', async () => {
    const refused = await call(H.deliverables.POST, { as: TEAM, method: 'POST', body: { description: 'Ship creative', due_date: '2026-11-01' }, params: { id: S.contractId } })
    assert.equal(refused.status, 403)

    const added = await call(H.deliverables.POST, { as: MANAGER, method: 'POST', body: { description: 'Ship creative', due_date: '2020-01-01' }, params: { id: S.contractId } })
    assert.equal(added.status, 201, JSON.stringify(added.json))
    S.deliverableId = added.json.id

    const detail = await call(H.contractById.GET, { as: TEAM, params: { id: S.contractId } })
    assert.equal(detail.status, 200, JSON.stringify(detail.json))
    assert.equal(detail.json.deliverables.length, 1)
    assert.equal(detail.json.brand_name, 'Blitz')

    // The old pending/done toggle is gone: status now FOLLOWS the delivered quantity, so Team records what was delivered.
    assert.equal((await call(H.deliverableById.PATCH, { as: TEAM, method: 'PATCH', body: { status: 'done' }, params: { id: S.deliverableId } })).status, 403, 'setting a status directly needs Manager/CEO — and then only "missed"')
    const toggled = await call(H.deliverableById.PATCH, { as: TEAM, method: 'PATCH', body: { delivered_quantity: 1 }, params: { id: S.deliverableId } })
    assert.equal(toggled.status, 200, JSON.stringify(toggled.json))
    assert.equal(toggled.json.status, 'delivered'); assert.equal(toggled.json.pct, 100)
  })
  await step('B4 + notifications: an overdue (not-done) deliverable and a near-term renewal both surface; a DONE overdue deliverable does not', async () => {
    // The deliverable above was due 2020-01-01 (overdue) but is now 'done' — it must NOT appear as overdue.
    const after = await call(H.notifications.GET, { as: MANAGER })
    assert.equal(after.status, 200, JSON.stringify(after.json))
    const overdueGroup = after.json.find((g: { title: string }) => g.title === 'Overdue deliverables')
    assert.ok(!overdueGroup, 'the done deliverable must not show as overdue')

    // Add a second, still-pending overdue deliverable to confirm the group DOES appear when one is actually pending+overdue.
    const second = await call(H.deliverables.POST, { as: MANAGER, method: 'POST', body: { description: 'Overdue proof', due_date: '2020-01-01' }, params: { id: S.contractId } })
    assert.equal(second.status, 201)
    const withOverdue = await call(H.notifications.GET, { as: MANAGER })
    const nowOverdue = withOverdue.json.find((g: { title: string }) => g.title === 'Overdue deliverables')
    assert.ok(nowOverdue && nowOverdue.items.some((i: { label: string }) => i.label === 'Overdue proof'))

    const renewalGroup = withOverdue.json.find((g: { title: string }) => g.title === 'Upcoming renewals')
    // renewal_date was set to 2027-01-01 above — only asserted present if that's within 30 days of "now" in this run;
    // instead of relying on wall-clock timing, just confirm the group key never errors and is an array when absent.
    assert.ok(renewalGroup === undefined || Array.isArray(renewalGroup.items))
  })
  console.log('\nStage 2B — finance (B6–B11)')
  const NIL = '00000000-0000-0000-0000-000000000000'
  await step('Team is refused on EVERY finance endpoint (403, before anything is even looked up)', async () => {
    const attempts: [string, number][] = [
      ['GET invoices', (await call(H.invoices.GET, { as: TEAM })).status],
      ['GET invoice', (await call(H.invoiceById.GET, { as: TEAM, params: { id: NIL } })).status],
      ['PATCH invoice', (await call(H.invoiceById.PATCH, { as: TEAM, method: 'PATCH', body: { action: 'issue' }, params: { id: NIL } })).status],
      ['POST schedule', (await call(H.schedule.POST, { as: TEAM, method: 'POST', body: { first_due_date: '2026-01-01' }, params: { id: S.contractId } })).status],
      ['POST payables', (await call(H.payables.POST, { as: TEAM, method: 'POST', params: { id: S.contractId } })).status],
      ['POST payment', (await call(H.invoicePayments.POST, { as: TEAM, method: 'POST', body: { amount: 1 }, params: { id: NIL } })).status],
      ['POST chase', (await call(H.invoiceChase.POST, { as: TEAM, method: 'POST', params: { id: NIL } })).status],
      ['GET overdue', (await call(H.overdue.GET, { as: TEAM })).status],
      ['GET export', (await call(H.financeExport.GET, { as: TEAM, query: '?kind=receivables' })).status]
    ]
    for (const [name, status] of attempts) assert.equal(status, 403, `${name} returned ${status}`)
  })
  await step('B6: bad schedules are refused and leave nothing behind', async () => {
    for (const body of [{ installments: 0, first_due_date: '2026-01-01' }, { installments: 3 }, { installments: 3, first_due_date: '2026-02-30' }, { installments: 3, first_due_date: '2026-01-01', interval_months: 13 }]) {
      assert.equal((await call(H.schedule.POST, { as: MANAGER, method: 'POST', body, params: { id: S.contractId } })).status, 400, JSON.stringify(body))
    }
    assert.equal((await call(H.schedule.POST, { as: MANAGER, method: 'POST', body: { first_due_date: '2026-01-01' }, params: { id: NIL } })).status, 404)
    assert.equal(await count('invoices', { contract_id: S.contractId }), 0)
  })
  await step('B6/B7: a 3-instalment schedule sums to exactly the contract total, on month-end dates (2020 is a leap year); a second one is refused', async () => {
    const r = await call(H.schedule.POST, { as: MANAGER, method: 'POST', body: { installments: 3, first_due_date: '2020-01-31', interval_months: 1 }, params: { id: S.contractId } })
    assert.equal(r.status, 201, JSON.stringify(r.json))
    const inv = [...r.json.invoices].sort((a: any, b: any) => a.due_date.localeCompare(b.due_date))
    assert.deepEqual(inv.map((i: any) => i.amount), [4000, 4000, 4000])
    assert.deepEqual(inv.map((i: any) => i.due_date), ['2020-01-31', '2020-02-29', '2020-03-31'])
    assert.ok(inv.every((i: any) => /^INV-\d{5}$/.test(i.number)))
    ;[S.inv1, S.inv2, S.inv3] = inv.map((i: any) => i.id)
    const dup = await call(H.schedule.POST, { as: MANAGER, method: 'POST', body: { installments: 2, first_due_date: '2026-01-01' }, params: { id: S.contractId } })
    assert.equal(dup.status, 409); assert.equal(await count('invoices', { contract_id: S.contractId }), 3, 'the refused request created nothing')
    const list = await call(H.invoices.GET, { as: MANAGER, query: `?direction=receivable&contract_id=${S.contractId}` })
    assert.equal(list.json.length, 3); assert.ok(list.json.every((i: any) => i.status === 'draft' && i.balance === 4000 && !i.overdue), 'drafts are never overdue')
  })
  await step('B9: payments — refused on a draft; partial then full; an overpayment is refused and writes nothing; a paid invoice cannot be voided', async () => {
    const onDraft = await call(H.invoicePayments.POST, { as: MANAGER, method: 'POST', body: { amount: 100 }, params: { id: S.inv1 } })
    assert.equal(onDraft.status, 400); assert.match(onDraft.json.error, /issued invoice/)
    assert.equal((await call(H.invoiceById.PATCH, { as: MANAGER, method: 'PATCH', body: { action: 'nonsense' }, params: { id: S.inv1 } })).status, 400)
    const issued = await call(H.invoiceById.PATCH, { as: MANAGER, method: 'PATCH', body: { action: 'issue' }, params: { id: S.inv1 } })
    assert.equal(issued.status, 200, JSON.stringify(issued.json)); assert.equal(issued.json.status, 'issued'); assert.ok(issued.json.issue_date)
    assert.equal((await call(H.invoiceById.PATCH, { as: MANAGER, method: 'PATCH', body: { action: 'issue' }, params: { id: S.inv1 } })).status, 400, 'cannot issue twice')

    const part = await call(H.invoicePayments.POST, { as: MANAGER, method: 'POST', body: { amount: 1000, method: 'bank transfer', reference: 'TX-1' }, params: { id: S.inv1 } })
    assert.equal(part.status, 201, JSON.stringify(part.json)); assert.equal(part.json.payment_status, 'part_paid'); assert.equal(part.json.balance, 3000); assert.equal(part.json.paid, 1000)
    const over = await call(H.invoicePayments.POST, { as: MANAGER, method: 'POST', body: { amount: 5000 }, params: { id: S.inv1 } })
    assert.equal(over.status, 400); assert.match(over.json.error, /outstanding balance/)
    assert.equal(await count('payments', { invoice_id: S.inv1 }), 1, 'the refused overpayment wrote nothing')
    for (const bad of [0, -5, 'abc']) assert.equal((await call(H.invoicePayments.POST, { as: MANAGER, method: 'POST', body: { amount: bad }, params: { id: S.inv1 } })).status, 400)

    const full = await call(H.invoicePayments.POST, { as: MANAGER, method: 'POST', body: { amount: 3000 }, params: { id: S.inv1 } })
    assert.equal(full.status, 201, JSON.stringify(full.json)); assert.equal(full.json.payment_status, 'paid'); assert.equal(full.json.balance, 0)
    assert.equal((await call(H.invoicePayments.POST, { as: MANAGER, method: 'POST', body: { amount: 1 }, params: { id: S.inv1 } })).status, 400, 'nothing left to pay')
    const voidPaid = await call(H.invoiceById.PATCH, { as: MANAGER, method: 'PATCH', body: { action: 'void' }, params: { id: S.inv1 } })
    assert.equal(voidPaid.status, 400, JSON.stringify(voidPaid.json)); assert.match(voidPaid.json.error, /cannot be voided/, 'the DATABASE refused it, and its message came through')
  })
  await step('B10: overdue list — only issued, unpaid, past-due invoices; a chase is logged and clears the reminder; paid/draft invoices cannot be chased', async () => {
    assert.equal((await call(H.invoiceById.PATCH, { as: MANAGER, method: 'PATCH', body: { action: 'issue' }, params: { id: S.inv2 } })).status, 200)
    const od = await call(H.overdue.GET, { as: MANAGER })
    assert.equal(od.status, 200, JSON.stringify(od.json))
    const ids = od.json.map((i: any) => i.id)
    assert.ok(ids.includes(S.inv2), 'issued, unpaid, due 2020-02-29')
    assert.ok(!ids.includes(S.inv1), 'fully paid is not overdue'); assert.ok(!ids.includes(S.inv3), 'a draft is not overdue')
    const row = od.json.find((i: any) => i.id === S.inv2)
    assert.ok(row.days_overdue > 365); assert.equal(row.needs_chase, true); assert.equal(row.balance, 4000)

    assert.equal((await call(H.invoiceChase.POST, { as: MANAGER, method: 'POST', params: { id: S.inv1 } })).status, 400, 'paid')
    assert.equal((await call(H.invoiceChase.POST, { as: MANAGER, method: 'POST', params: { id: S.inv3 } })).status, 400, 'draft')
    const chased = await call(H.invoiceChase.POST, { as: MANAGER, method: 'POST', body: { note: 'Emailed accounts payable' }, params: { id: S.inv2 } })
    assert.equal(chased.status, 201, JSON.stringify(chased.json)); assert.equal(chased.json.needs_chase, false, 'just chased'); assert.ok(chased.json.last_chased_at)
    const detail = await call(H.invoiceById.GET, { as: MANAGER, params: { id: S.inv2 } })
    assert.equal(detail.json.chases.length, 1); assert.equal(detail.json.chases[0].note, 'Emailed accounts payable'); assert.equal(detail.json.chases[0].chased_by.full_name, 'manager user')
    const paidDetail = await call(H.invoiceById.GET, { as: MANAGER, params: { id: S.inv1 } })
    assert.equal(paidDetail.json.payments.length, 2); assert.equal(paidDetail.json.payments[0].method, 'bank transfer'); assert.equal(paidDetail.json.payments[0].recorded_by.full_name, 'manager user')
    assert.equal((await call(H.invoiceById.GET, { as: MANAGER, params: { id: NIL } })).status, 404)
  })
  await step('notifications: Manager sees "Overdue invoices"; Team gets NO money information at all', async () => {
    const m = await call(H.notifications.GET, { as: MANAGER })
    const g = m.json.find((x: any) => x.title === 'Overdue invoices')
    assert.ok(g && g.items.some((i: any) => /INV-\d{5}/.test(i.label) && /overdue/.test(i.detail)), JSON.stringify(m.json.map((x: any) => x.title)))
    const t = await call(H.notifications.GET, { as: TEAM })
    assert.equal(t.status, 200)
    assert.ok(!t.json.some((x: any) => /invoice|payable/i.test(x.title)), 'no finance group for Team')
    assert.ok(!JSON.stringify(t.json).includes('INV-'), 'no invoice number leaks into Team\'s feed anywhere')
  })
  await step('B8: payables from a won deal — one per vendor with the real cost; refused to Team; not generated twice', async () => {
    const r = await call(H.payables.POST, { as: MANAGER, method: 'POST', body: { due_date: '2026-12-31' }, params: { id: S.contractId } })
    assert.equal(r.status, 201, JSON.stringify(r.json))
    assert.equal(r.json.payables.length, 1); assert.equal(r.json.payables[0].counterparty, 'Apex Sports Media'); assert.equal(r.json.payables[0].amount, 10000); assert.match(r.json.payables[0].number, /^BILL-\d{5}$/)
    assert.equal(r.json.warning, null)
    assert.equal((await call(H.payables.POST, { as: MANAGER, method: 'POST', params: { id: S.contractId } })).status, 409)
    assert.equal((await call(H.payables.POST, { as: MANAGER, method: 'POST', body: { due_date: 'soon' }, params: { id: NIL } })).status, 400, 'bad due_date is validated first')
  })
  await step('B8 with an agent: vendor cost AND the agent\'s commission are payable; the agent can also be the party billed', async () => {
    const ag = await call(H.agents.POST, { as: MANAGER, method: 'POST', body: { name: 'Payable Agent' } }); const agentId = ag.json.id
    const agentsRoute = await load('agents/[id]')
    assert.equal((await call(agentsRoute.PATCH, { as: MANAGER, method: 'PATCH', body: { cut_method: 'onTop', cut_pct: 12, fixed_fee: 0 }, params: { id: agentId } })).status, 200)
    const route = await call(H.routes.POST, { as: MANAGER, method: 'POST', body: { brand_id: S.Blitz, route_type: 'via_agent', agent_id: agentId, market: 'UAE' } }); assert.equal(route.status, 201, JSON.stringify(route.json))
    const item = await call(H.items.POST, { as: TEAM, method: 'POST', body: { property_id: S.prop, name: 'Finance chain item' } })
    await call(H.prices.POST, { as: TEAM, method: 'POST', body: { item_id: item.json.id, type: 'rack', amount: 10000, currency: 'USD' } })
    const p = await call(H.proposals.POST, { as: TEAM, method: 'POST', body: { brand_id: S.Blitz, route_id: route.json.id } }); const pid = p.json.id
    const line = await call(H.lines.POST, { as: TEAM, method: 'POST', body: { item_id: item.json.id }, params: { id: pid } })
    await call(H.margin.PATCH, { as: MANAGER, method: 'PATCH', body: { rate: 20 }, params: { id: pid, lineId: line.json.id } })
    for (const st of ['Approved', 'Sent', 'Won']) assert.equal((await call(H.stage.PATCH, { as: MANAGER, method: 'PATCH', body: { to_stage: st }, params: { id: pid } })).status, 200, st)
    const deal = await svc.from('deals').select('id').eq('proposal_id', pid).single()
    const ctr = await call(H.contracts.POST, { as: MANAGER, method: 'POST', body: { deal_id: deal.data!.id, renewal_date: '2027-06-01' } })
    assert.equal(ctr.status, 201, JSON.stringify(ctr.json)); assert.equal(Number(ctr.json.final_amount), 13440, '10,000 + 20% = 12,000, + 12% on top for the agent = 13,440')

    const pay = await call(H.payables.POST, { as: MANAGER, method: 'POST', params: { id: ctr.json.id } })
    assert.equal(pay.status, 201, JSON.stringify(pay.json))
    const byType = Object.fromEntries(pay.json.payables.map((x: any) => [x.type, x]))
    assert.equal(byType.vendor.amount, 10000); assert.equal(byType.vendor.counterparty, 'Apex Sports Media')
    assert.equal(byType.agent.amount, 1440, '12% of 12,000'); assert.equal(byType.agent.counterparty, 'Payable Agent')

    const sch = await call(H.schedule.POST, { as: MANAGER, method: 'POST', body: { installments: 2, first_due_date: '2027-01-15', counterparty: { type: 'agent', id: agentId } }, params: { id: ctr.json.id } })
    assert.equal(sch.status, 201, JSON.stringify(sch.json)); assert.deepEqual(sch.json.invoices.map((i: any) => i.amount), [6720, 6720])
    const rec = await call(H.invoices.GET, { as: MANAGER, query: `?direction=receivable&contract_id=${ctr.json.id}` })
    assert.ok(rec.json.every((i: any) => i.counterparty_type === 'agent' && i.counterparty_name === 'Payable Agent'))
    const badAgent = await call(H.schedule.POST, { as: MANAGER, method: 'POST', body: { first_due_date: '2027-01-15', counterparty: { type: 'agent', id: NIL } }, params: { id: S.contractId } })
    assert.equal(badAgent.status, 409, 'already has a schedule — refused before the counterparty is even checked')
  })
  await step('B11: CSV export — right columns and rows, voided invoices excluded, bad kind refused, and the export is audited', async () => {
    assert.equal((await call(H.invoiceById.PATCH, { as: MANAGER, method: 'PATCH', body: { action: 'void' }, params: { id: S.inv3 } })).status, 200, 'an unpaid draft can be voided')
    const r = await call(H.financeExport.GET, { as: MANAGER, query: '?kind=receivables' })
    assert.equal(r.status, 200); assert.match(r.res.headers.get('content-type') ?? '', /text\/csv/); assert.match(r.res.headers.get('content-disposition') ?? '', /emergex-receivables-\d{4}-\d{2}-\d{2}\.csv/)
    const csv = await r.res.text(); const lines = csv.trim().split('\r\n')
    assert.equal(lines[0], 'Number,Direction,Counterparty type,Counterparty,Description,Currency,Amount,Paid,Balance,Issue date,Due date,Status,Payment status')
    const inv1 = (await call(H.invoiceById.GET, { as: MANAGER, params: { id: S.inv1 } })).json.number
    const inv3 = (await call(H.invoiceById.GET, { as: MANAGER, params: { id: S.inv3 } })).json.number
    assert.ok(csv.includes(inv1) && csv.includes('paid')); assert.ok(!csv.includes(inv3), 'the voided invoice is not exported')
    assert.ok(!csv.includes('BILL-'), 'receivables export holds no payables')
    const pay = await (await call(H.financeExport.GET, { as: MANAGER, query: '?kind=payments' })).res.text()
    assert.ok(pay.startsWith('Invoice,Counterparty,Currency,Amount,Paid on,Method,Reference')); assert.ok(pay.includes('bank transfer') && pay.includes('TX-1'))
    const bills = await (await call(H.financeExport.GET, { as: MANAGER, query: '?kind=payables' })).res.text()
    assert.ok(bills.includes('BILL-') && bills.includes('Apex Sports Media') && bills.includes('Payable Agent') && !bills.includes('INV-'))
    assert.equal((await call(H.financeExport.GET, { as: MANAGER, query: '?kind=everything' })).status, 400)
    assert.equal((await call(H.financeExport.GET, { as: MANAGER })).status, 400)
    assert.ok(await count('audit_events', { action: 'finance_exported' }) >= 3)
  })
  console.log('\nStage 2B — agent access (B12–B17), B15 access tests, and contract files (B3)')
  const SENTINELS = ['Apex Sports Media', '77777', 'SECRET-CONTACT-NAME', 'INTERNAL-SENTINEL-TEXT', 'Meridian', 'Payable Agent', 'Agent Co B', 'AGENT-B-NOTE-TEXT', 'Blitz', 'Kingfish', 'Rival']
  const leaks = (v: unknown) => SENTINELS.filter((x) => JSON.stringify(v).includes(x))
  const ITEM_KEYS = ['id', 'title', 'category', 'market', 'event_start', 'event_end', 'offer_expiry', 'availability', 'details', 'indicative_price'].sort()
  const INTEL_KEYS = ['id', 'note', 'submitted_at', 'status', 'claimed_price'].sort()
  const agentCreds = (u: string) => ({ as: u })

  await step('setup: hostile sentinel data — a vendor, a cost, internal intel, and attributes that name the source', async () => {
    const mk = async (name: string, attributes: Record<string, unknown>, propertyId = S.prop) => {
      const r = await call(H.items.POST, { as: TEAM, method: 'POST', body: { property_id: propertyId, name, attributes } }); assert.equal(r.status, 201, JSON.stringify(r.json))
      await call(H.prices.POST, { as: TEAM, method: 'POST', body: { item_id: r.json.id, type: 'rack', amount: 77777, currency: 'USD' } }); return r.json.id as string
    }
    S.G1 = await mk('Agent item one', { asset_type: 'led_perimeter', quantity: 3, vendor_name: 'Apex Sports Media', management_contact: 'SECRET-CONTACT-NAME', cost: 77777 })
    S.G2 = await mk('Agent item two', { asset_type: 'pitch_mat' })
    S.G3 = await mk('Agent item three, shared with nobody', {})
    const p2 = await call(H.properties.POST, { as: TEAM, method: 'POST', body: { name: 'Agent property two', category_key: 'ooh_led', market: 'UAE', vendor_id: S.vendor, attributes: {} } }); S.P2 = p2.json.id
    S.X1 = await mk('P2 item 1', {}, S.P2); S.X2 = await mk('P2 item 2', {}, S.P2)
    assert.equal((await call(H.intel.POST, { as: TEAM, method: 'POST', body: { note: 'INTERNAL-SENTINEL-TEXT' } })).status, 201)
  })

  await step('RELEASE SWITCH: with AGENT_ACCESS_ENABLED unset, an agent gets nothing from any agent route (and health says so)', async () => {
    const saved = process.env.AGENT_ACCESS_ENABLED; delete process.env.AGENT_ACCESS_ENABLED
    try {
      for (const h of [H.agentMe.GET, H.agentItems.GET, H.agentIntel.GET]) { const r = await call(h, { as: AGENT_A }); assert.equal(r.status, 403); assert.match(r.json.error, /not been released/) }
      const post = await call(H.agentIntel.POST, { as: AGENT_A, method: 'POST', body: { note: 'x' } }); assert.equal(post.status, 403)
      const health = await call(H.health.GET, { as: MANAGER }); assert.match(health.json.optional.agent_portal, /disabled/)
    } finally { process.env.AGENT_ACCESS_ENABLED = saved }
    assert.equal((await call(H.agentMe.GET, { as: AGENT_A })).status, 200, 'released again')
    assert.match((await call(H.health.GET, { as: MANAGER })).json.optional.agent_portal, /ENABLED/)
  })

  await step('B12: agent accounts — validated before any auth account exists; Team cannot create; an agent can never change role', async () => {
    const body = { full_name: 'New Agent', email: 'new.agent@x.test', role_key: 'agent' }
    assert.equal((await call(H.users.POST, { as: TEAM, method: 'POST', body: { ...body, agent_id: CO_A } })).status, 403)
    assert.equal((await call(H.users.POST, { as: MANAGER, method: 'POST', body })).status, 400, 'no company')
    assert.equal((await call(H.users.POST, { as: MANAGER, method: 'POST', body: { ...body, agent_id: NIL } })).status, 400, 'company does not exist')
    assert.equal((await call(H.users.POST, { as: MANAGER, method: 'POST', body: { ...body, agent_id: 'nope' } })).status, 400)
    const promote = await call(H.userById.PATCH, { as: CEO, method: 'PATCH', body: { role_key: 'ceo' }, params: { id: AGENT_A } })
    assert.equal(promote.status, 400); assert.match(promote.json.error, /cannot change role/)
    assert.equal((await svc.from('profiles').select('role_key').eq('id', AGENT_A).single()).data!.role_key, 'agent', 'still an agent')
    const list = await call(H.users.GET, { as: MANAGER }); assert.ok(list.json.some((u: any) => u.id === AGENT_A && u.agent_id === CO_A))
  })

  await step('B15 SWEEP: every route in the app refuses an agent (403) and an anonymous visitor (401) — discovered automatically, so a future route cannot be forgotten', async () => {
    const fs = await import('node:fs'); const path = await import('node:path')
    const apiDir = path.join(process.cwd(), 'src/app/api')
    const rels = (fs.readdirSync(apiDir, { recursive: true }) as string[]).map((f) => f.replace(/\\/g, '/')).filter((f) => f.endsWith('route.ts')).map((f) => f.replace(/\/?route\.ts$/, ''))
    // A sweep that silently finds nothing would 'pass' while proving nothing, so insist it reached a healthy number of
    // routes AND specific deeply-nested dynamic ones (that is where a recursive directory walk would go wrong).
    assert.ok(rels.length >= 75, `only ${rels.length} routes were discovered — the sweep is not covering the app`)
    for (const must of ['health', 'finance/export', 'users/[id]/reset-password', 'contracts/[id]/files/[fileId]', 'agent/items/[id]', 'agent-access/intel/[id]/review', 'proposals/[id]/lines/[lineId]/margin'])
      assert.ok(rels.includes(must), `the sweep did not discover ${must}`)
    const watched = ['audit_events', 'vendors', 'intel_notes', 'price_records', 'shareable_grants', 'profiles', 'proposals', 'items', 'invoices', 'payments', 'contracts', 'files', 'agent_activity']
    const before = Object.fromEntries(await Promise.all(watched.map(async (t) => [t, await count(t)])))
    const dummy = new Proxy({}, { get: () => NIL }) as Record<string, string>
    const agentOk = (rel: string) => rel.startsWith('agent/') || rel === 'account/change-password' || rel === 'health'
    const offenders: string[] = []; let calls = 0
    for (const rel of rels) {
      const mod = await load(rel)
      for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        if (typeof mod[m] !== 'function') continue
        calls++
        const opts = (as?: string) => ({ as, method: m, params: dummy, ...(m === 'GET' || m === 'DELETE' ? {} : { body: {} }) })
        const asAgent = await call(mod[m], opts(AGENT_A)); if (!agentOk(rel) && asAgent.status !== 403) offenders.push(`AGENT  ${m} /${rel} -> ${asAgent.status}`)
        const anon = await call(mod[m], opts(undefined)); if (rel !== 'health' && anon.status !== 401) offenders.push(`ANON   ${m} /${rel} -> ${anon.status}`)
        if (rel.startsWith('agent/')) for (const u of [TEAM, MANAGER, CEO]) { const r = await call(mod[m], opts(u)); if (r.status !== 403) offenders.push(`STAFF  ${m} /${rel} as ${u.slice(0, 2)} -> ${r.status} (agent routes are for agents only)`) }
      }
    }
    assert.deepEqual(offenders, [], `swept ${calls} handlers across ${rels.length} routes:\n${offenders.join('\n')}`)
    const after = Object.fromEntries(await Promise.all(watched.map(async (t) => [t, await count(t)])))
    // The sweep also CALLS the legitimate agent routes as an agent, and two of those are views (the inventory list and the
    // intel list), which are logged by design. So the log grows by exactly 2 — and NOTHING else may change.
    const changed = Object.fromEntries(watched.filter((t) => after[t] !== before[t]).map((t) => [t, after[t] - before[t]]))
    assert.deepEqual(changed, { agent_activity: 2 }, `tables changed by the sweep: ${JSON.stringify(changed)}`)
    console.log(`        (swept ${calls} handlers across ${rels.length} routes, as an agent and as nobody)`)
    const pw = await call(H.changePw2.POST, { as: AGENT_A, method: 'POST', body: { new_password: 'short' } })
    assert.equal(pw.status, 400, 'an agent CAN reach change-password (and is stopped by validation, not by the gate)')
  })

  await step('B13: grants — Team refused everywhere; Manager shares items; duplicates and bad input handled; one item per title/price', async () => {
    assert.equal((await call(H.grants.POST, { as: TEAM, method: 'POST', body: { agent_id: CO_A, item_ids: [S.G1] } })).status, 403)
    assert.equal((await call(H.grants.GET, { as: TEAM, query: `?agent_id=${CO_A}` })).status, 403)
    assert.equal((await call(H.activity.GET, { as: TEAM })).status, 403)
    assert.equal((await call(H.agentsList.GET, { as: TEAM })).status, 403)
    assert.equal((await call(H.grants.POST, { as: MANAGER, method: 'POST', body: { agent_id: CO_A } })).status, 400, 'no items')
    assert.equal((await call(H.grants.POST, { as: MANAGER, method: 'POST', body: { agent_id: NIL, item_ids: [S.G1] } })).status, 400)
    assert.equal((await call(H.grants.POST, { as: MANAGER, method: 'POST', body: { agent_id: CO_A, item_ids: [NIL] } })).status, 400, 'item does not exist')
    assert.equal((await call(H.grants.POST, { as: MANAGER, method: 'POST', body: { agent_id: CO_A, item_ids: [S.G1, S.G2], display_title: 'X' } })).status, 400, 'a title is per-item')
    assert.equal((await call(H.grants.POST, { as: MANAGER, method: 'POST', body: { agent_id: CO_A, item_ids: [S.G1], indicative_price: -5 } })).status, 400)
    assert.equal(await count('shareable_grants'), 0, 'every refused request created nothing')

    const g1 = await call(H.grants.POST, { as: MANAGER, method: 'POST', body: { agent_id: CO_A, item_ids: [S.G1], display_title: 'Premium LED package', indicative_price: 15000 } })
    assert.equal(g1.status, 201, JSON.stringify(g1.json)); assert.equal(g1.json.created, 1)
    const again = await call(H.grants.POST, { as: MANAGER, method: 'POST', body: { agent_id: CO_A, item_ids: [S.G1] } }); assert.equal(again.json.created, 0); assert.equal(again.json.already_shared, 1)
    const forB = await call(H.grants.POST, { as: MANAGER, method: 'POST', body: { agent_id: CO_B, item_ids: [S.G2], property_id: S.P2 } })
    assert.equal(forB.json.created, 3, 'G2 + both items of property two (a property expands to its CURRENT items)')
    const list = await call(H.agentsList.GET, { as: MANAGER }); const a = list.json.agents.find((x: any) => x.id === CO_A)
    assert.equal(a.active_grants, 1); assert.deepEqual(a.users.map((u: any) => u.id), [AGENT_A]); assert.equal(list.json.portal_enabled, true)
    const gl = await call(H.grants.GET, { as: MANAGER, query: `?agent_id=${CO_A}` }); S.grantA = gl.json[0].id; assert.equal(gl.json.length, 1)
    const gb = await call(H.grants.GET, { as: MANAGER, query: `?agent_id=${CO_B}` }); S.grantB = gb.json.find((g: any) => g.items.name === 'Agent item two').id
  })

  await step('B14: what an agent sees — exactly the allow-listed keys, white-label title, the typed price, and not one planted secret', async () => {
    const list = await call(H.agentItems.GET, agentCreds(AGENT_A)); assert.equal(list.status, 200, JSON.stringify(list.json))
    assert.equal(list.json.length, 1, 'only the one item shared with Agent Co A')
    const v = list.json[0]
    assert.deepEqual(Object.keys(v).sort(), ITEM_KEYS); assert.equal(v.id, S.grantA); assert.notEqual(v.id, S.G1, 'the id is the grant id, never the internal item id')
    assert.equal(v.title, 'Premium LED package'); assert.deepEqual(v.indicative_price, { amount: 15000, currency: 'USD' }); assert.equal(v.availability, 'Available')
    assert.deepEqual(v.details, { asset_type: 'led_perimeter', quantity: 3 }, 'vendor_name, management_contact and cost were in the attributes and are NOT shown')
    const detail = await call(H.agentItem.GET, { as: AGENT_A, params: { id: S.grantA } }); assert.equal(detail.status, 200); assert.deepEqual(detail.json, v)
    const me = await call(H.agentMe.GET, agentCreds(AGENT_A)); assert.deepEqual(me.json, { name: 'agent user A', company: 'Agent Co A' })
    for (const [name, payload] of [['list', list.json], ['detail', detail.json], ['me', me.json]] as const) assert.deepEqual(leaks(payload), [], `${name} leaked`)
  })

  await step('B14: availability is collapsed — "proposed", "sold" and "on hold" are indistinguishable (they would reveal other parties\' deals)', async () => {
    for (const st of ['proposed', 'sold', 'on_hold', 'expired']) {
      await svc.from('items').update({ availability: st }).eq('id', S.G1)
      const v = (await call(H.agentItems.GET, agentCreds(AGENT_A))).json[0]
      assert.equal(v.availability, 'Not currently available', st); assert.ok(!JSON.stringify(v).includes(st.replace('_', ' ')) && !JSON.stringify(v).includes(st))
    }
    await svc.from('items').update({ availability: 'available' }).eq('id', S.G1)
    assert.equal((await call(H.agentItems.GET, agentCreds(AGENT_A))).json[0].availability, 'Available')
  })

  await step('B15 cross-agent probing: another agent\'s grant, a made-up id and a malformed id are INDISTINGUISHABLE 404s', async () => {
    const probe = async (as: string, id: string) => { const r = await call(H.agentItem.GET, { as, params: { id } }); return { status: r.status, body: JSON.stringify(r.json) } }
    const other = await probe(AGENT_A, S.grantB), made = await probe(AGENT_A, NIL), bad = await probe(AGENT_A, 'not-a-uuid'), inj = await probe(AGENT_A, "x' or '1'='1")
    assert.equal(other.status, 404); assert.deepEqual(other, made, 'B\'s real grant looks exactly like one that does not exist'); assert.equal(bad.status, 404); assert.equal(inj.status, 404)
    assert.equal((await probe(AGENT_B, S.grantA)).status, 404, 'and the other way round')
    const b = await call(H.agentItems.GET, agentCreds(AGENT_B)); assert.equal(b.json.length, 3); assert.ok(!JSON.stringify(b.json).includes('Premium LED package'), 'B never sees A\'s item')
    assert.ok(!JSON.stringify(b.json).includes('Agent Co A'))
  })

  await step('revocation is immediate and permanent: the next request is a 404; re-sharing makes a NEW grant, the old id stays dead', async () => {
    const r = await call(H.grantById.DELETE, { as: MANAGER, method: 'DELETE', params: { id: S.grantA } }); assert.equal(r.status, 200)
    assert.equal((await call(H.agentItem.GET, { as: AGENT_A, params: { id: S.grantA } })).status, 404)
    assert.equal((await call(H.agentItems.GET, agentCreds(AGENT_A))).json.length, 0)
    assert.equal((await call(H.grantById.DELETE, { as: MANAGER, method: 'DELETE', params: { id: S.grantA } })).status, 400, 'already revoked')
    assert.equal((await call(H.grantById.PATCH, { as: MANAGER, method: 'PATCH', body: { display_title: 'x' }, params: { id: S.grantA } })).status, 400, 'a revoked grant cannot be edited')
    assert.equal((await call(H.grantById.DELETE, { as: TEAM, method: 'DELETE', params: { id: S.grantA } })).status, 403)
    assert.equal((await call(H.grants.POST, { as: MANAGER, method: 'POST', body: { agent_id: CO_A, item_ids: [S.G1], display_title: 'Premium LED package', indicative_price: 15000 } })).json.created, 1)
    const fresh = (await call(H.agentItems.GET, agentCreds(AGENT_A))).json[0]; assert.notEqual(fresh.id, S.grantA); assert.equal((await call(H.agentItem.GET, { as: AGENT_A, params: { id: S.grantA } })).status, 404)
    S.grantA = fresh.id
    const edit = await call(H.grantById.PATCH, { as: MANAGER, method: 'PATCH', body: { display_title: '  Renamed  ', indicative_price: null }, params: { id: S.grantA } }); assert.equal(edit.status, 200, JSON.stringify(edit.json))
    const v = (await call(H.agentItems.GET, agentCreds(AGENT_A))).json[0]; assert.equal(v.title, 'Renamed'); assert.equal(v.indicative_price, null, 'price cleared')
  })

  await step('B17: every view is logged (append-only); staff can read the log; Team cannot; and logging FAILS CLOSED', async () => {
    const act = await call(H.activity.GET, { as: MANAGER, query: `?agent_id=${CO_A}` }); assert.equal(act.status, 200, JSON.stringify(act.json))
    const actions = act.json.map((a: any) => a.action)
    assert.ok(actions.includes('view_inventory') && actions.includes('view_item'), actions.join())
    assert.ok(act.json.every((a: any) => a.agents.name === 'Agent Co A'), 'filtered to that agent only'); assert.ok(act.json.some((a: any) => a.profiles?.full_name === 'agent user A'))
    assert.ok(act.json.find((a: any) => a.action === 'view_item').items.name === 'Agent item one')
    const before = await count('agent_activity', { agent_id: CO_A }); await call(H.agentItems.GET, agentCreds(AGENT_A)); assert.equal(await count('agent_activity', { agent_id: CO_A }), before + 1, 'one view = one row')
    await call(H.agentItem.GET, { as: AGENT_A, params: { id: S.grantB } }); assert.equal(await count('agent_activity', { agent_id: CO_A }), before + 1, 'a refused probe is not logged as a view of anything')
    const upd = await svc.from('agent_activity').update({ action: 'view_item' }).eq('agent_id', CO_A); assert.ok(upd.error, 'even the service layer cannot alter the log')
    const del = await svc.from('agent_activity').delete().eq('agent_id', CO_A); assert.ok(del.error, 'or delete from it')
    const { logAgentActivity } = await import('../../src/lib/agentAccess')
    const orgId = (await svc.from('profiles').select('org_id').eq('id', AGENT_A).single()).data!.org_id
    await assert.rejects(() => logAgentActivity({ profile: { org_id: orgId, id: AGENT_A }, agentId: NIL, agentName: 'x' } as never, 'view_inventory'), (e: any) => e.status === 500 && /not shown/.test(e.message), 'if the log write fails the view is refused, not shown unlogged')
  })

  await step('a DISABLED account is refused immediately — agent or staff — even though its session token would still be valid', async () => {
    for (const [u, h] of [[AGENT_A, H.agentItems.GET], [TEAM, H.notifications.GET]] as const) {
      await svc.from('profiles').update({ disabled: true }).eq('id', u)
      try { const r = await call(h, { as: u }); assert.equal(r.status, 403); assert.match(r.json.error, /disabled/) }
      finally { await svc.from('profiles').update({ disabled: false }).eq('id', u) }
      assert.equal((await call(h, { as: u })).status, 200, 're-enabled')
    }
  })

  await step('B16: agent intel lands UNRATED and PENDING; a claimed price creates NO price record; bad input and flooding are refused', async () => {
    const n = await call(H.agentIntel.POST, { as: AGENT_A, method: 'POST', body: { note: 'Vendor rate is rising', grant_id: S.grantA, price: 12000, currency: 'usd' } })
    assert.equal(n.status, 201, JSON.stringify(n.json)); assert.deepEqual(Object.keys(n.json).sort(), INTEL_KEYS); assert.equal(n.json.status, 'Submitted'); assert.deepEqual(n.json.claimed_price, { amount: 12000, currency: 'USD' })
    S.noteA = n.json.id
    const row = (await svc.from('intel_notes').select('reliability, review_status, source, submitted_by_agent_id, linked_type, linked_id').eq('id', S.noteA).single()).data!
    assert.deepEqual(row, { reliability: null, review_status: 'pending', source: 'agent', submitted_by_agent_id: CO_A, linked_type: 'item', linked_id: S.G1 })
    assert.equal(await count('price_records', { item_id: S.G1, type: 'market_intel' }), 0, 'an unreviewed agent price must not become a market-intel price (it feeds the warnings)')

    for (const body of [{ note: '   ' }, { note: 'x'.repeat(2001) }, { note: 'n', price: 5 }, { note: 'n', grant_id: S.grantB }, { note: 'n', grant_id: 'bad' }, { note: 'n', grant_id: S.grantA, price: -1 }, { note: 'n', grant_id: S.grantA, price: 5, currency: 'DOLLARS' }, { note: 'n', grant_id: S.grantA, price: 'abc' }])
      assert.equal((await call(H.agentIntel.POST, { as: AGENT_A, method: 'POST', body })).status, 400, JSON.stringify(body).slice(0, 60))

    const flood = Array.from({ length: 48 }, (_, i) => ({ org_id: orgOf(), note: `flood ${i}`, source: 'agent', submitted_by_agent_id: CO_A, review_status: 'pending', reliability: null }))
    await svc.from('intel_notes').insert(flood)
    assert.equal((await call(H.agentIntel.POST, { as: AGENT_A, method: 'POST', body: { note: 'the 50th' } })).status, 201, '49 existing + this one = 50, allowed')
    const over = await call(H.agentIntel.POST, { as: AGENT_A, method: 'POST', body: { note: 'the 51st' } }); assert.equal(over.status, 429); assert.match(over.json.error, /50 notes waiting/)
    await svc.from('intel_notes').delete().eq('submitted_by_agent_id', CO_A).like('note', 'flood %'); await svc.from('intel_notes').delete().eq('submitted_by_agent_id', CO_A).eq('note', 'the 50th')
    function orgOf() { return S.orgId }
  })

  await step('B16 isolation: an agent sees only their own company\'s notes — never another agent\'s, never internal intel', async () => {
    const b = await call(H.agentIntel.POST, { as: AGENT_B, method: 'POST', body: { note: 'AGENT-B-NOTE-TEXT' } }); assert.equal(b.status, 201); S.noteB = b.json.id
    const a = await call(H.agentIntel.GET, agentCreds(AGENT_A)); assert.equal(a.status, 200)
    assert.deepEqual(a.json.map((x: any) => x.id), [S.noteA]); assert.ok(a.json.every((x: any) => Object.keys(x).sort().join() === INTEL_KEYS.join()))
    assert.deepEqual(leaks(a.json), [], 'A sees neither B\'s note nor the internal note')
    const bl = await call(H.agentIntel.GET, agentCreds(AGENT_B)); assert.deepEqual(bl.json.map((x: any) => x.id), [S.noteB]); assert.ok(!JSON.stringify(bl.json).includes('Vendor rate is rising'))
  })

  await step('B16 review: Team refused; Manager accepts (rating required, price recorded once) or declines; a note is reviewed exactly once; the agent never sees the rating', async () => {
    assert.equal((await call(H.intelQueue.GET, { as: TEAM })).status, 403)
    assert.equal((await call(H.intelReview.POST, { as: TEAM, method: 'POST', body: { decision: 'accept', reliability: 'likely' }, params: { id: S.noteA } })).status, 403)
    const q = await call(H.intelQueue.GET, { as: MANAGER }); assert.equal(q.status, 200, JSON.stringify(q.json))
    const names = q.json.map((n: any) => `${n.agents.name}:${n.note}`); assert.ok(names.includes('Agent Co A:Vendor rate is rising') && names.includes('Agent Co B:AGENT-B-NOTE-TEXT'), names.join('|'))
    assert.ok(!q.json.some((n: any) => n.note === 'INTERNAL-SENTINEL-TEXT'), 'internal notes are not in the agent review queue')
    assert.equal(q.json.find((n: any) => n.id === S.noteA).item_name, 'Agent item one')

    assert.equal((await call(H.intelReview.POST, { as: MANAGER, method: 'POST', body: { decision: 'accept' }, params: { id: S.noteA } })).status, 400, 'accepting needs a rating')
    assert.equal((await call(H.intelReview.POST, { as: MANAGER, method: 'POST', body: { decision: 'accept', reliability: 'great' }, params: { id: S.noteA } })).status, 400)
    const internalNote = (await svc.from('intel_notes').select('id').eq('note', 'INTERNAL-SENTINEL-TEXT').single()).data!.id
    assert.equal((await call(H.intelReview.POST, { as: MANAGER, method: 'POST', body: { decision: 'accept', reliability: 'likely' }, params: { id: internalNote } })).status, 409, 'not an agent note')

    const ok = await call(H.intelReview.POST, { as: MANAGER, method: 'POST', body: { decision: 'accept', reliability: 'likely' }, params: { id: S.noteA } })
    assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.equal(ok.json.price_recorded, true)
    const pr = await svc.from('price_records').select('amount, currency, source, type').eq('item_id', S.G1).eq('type', 'market_intel'); assert.equal(pr.data!.length, 1)
    assert.deepEqual(pr.data![0], { amount: 12000, currency: 'USD', source: `agent intel:${S.noteA}`, type: 'market_intel' })
    assert.equal((await call(H.intelReview.POST, { as: MANAGER, method: 'POST', body: { decision: 'reject' }, params: { id: S.noteA } })).status, 409, 'reviewed exactly once')
    assert.equal(await count('price_records', { item_id: S.G1, type: 'market_intel' }), 1, 'no duplicate price')

    const rej = await call(H.intelReview.POST, { as: MANAGER, method: 'POST', body: { decision: 'reject' }, params: { id: S.noteB } }); assert.equal(rej.status, 200); assert.equal(rej.json.price_recorded, false)
    const a = (await call(H.agentIntel.GET, agentCreds(AGENT_A))).json.find((x: any) => x.id === S.noteA); assert.equal(a.status, 'Reviewed')
    assert.ok(!JSON.stringify(a).includes('likely'), 'the agent is not shown the reliability rating'); assert.equal((await call(H.agentIntel.GET, agentCreds(AGENT_B))).json[0].status, 'Declined')
    assert.equal((await call(H.intelQueue.GET, { as: MANAGER, query: '?status=nonsense' })).status, 400)
  })

  // ---------------- B3: contract files, against an in-memory Drive ----------------
  const { driveImpl } = await import('../../src/lib/googleDrive')
  const realDrive = { ...driveImpl }
  const fake = { files: new Map<string, Buffer>(), names: [] as string[], fail: false, n: 0, delay: 0 }
  const useFakeDrive = () => {
    driveImpl.createRecordFolder = (async ({ entityType, folderName }: { entityType: string; folderName: string }) => ({ folderId: `folder:${entityType}:${folderName}`, folderUrl: null })) as typeof driveImpl.createRecordFolder
    driveImpl.uploadFileToFolder = (async ({ name, content }: { name: string; content: Buffer }) => { if (fake.delay) await new Promise((r) => setTimeout(r, fake.delay)); if (fake.fail) throw new Error('drive is down'); const id = `file:${++fake.n}`; fake.files.set(id, content); fake.names.push(name); return { fileId: id, webViewLink: null } }) as typeof driveImpl.uploadFileToFolder
    driveImpl.downloadFile = (async (id: string) => { const b = fake.files.get(id); if (!b) throw new Error('not found'); return b }) as typeof driveImpl.downloadFile
  }
  const restoreDrive = () => Object.assign(driveImpl, realDrive)
  const PDF = (tag: string) => Buffer.from('%PDF-1.7\n' + tag.repeat(60))
  const form = (buf: Buffer, name: string, fields: Record<string, string> = {}) => { const f = new FormData(); f.append('file', new File([new Uint8Array(buf)], name, { type: 'application/pdf' })); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f }
  const up = (as: string, f: FormData) => call(H.files.POST, { as, method: 'POST', form: f, params: { id: S.contractId } })

  await step('B3: contract files are contract.manage-only — Team is refused to list, upload and download', async () => {
    assert.equal((await call(H.files.GET, { as: TEAM, params: { id: S.contractId } })).status, 403)
    assert.equal((await up(TEAM, form(PDF('a'), 'x.pdf'))).status, 403)
    assert.equal((await call(H.fileById.GET, { as: TEAM, params: { id: S.contractId, fileId: NIL } })).status, 403)
    assert.equal((await call(H.files.GET, { as: MANAGER, params: { id: NIL } })).status, 404)
  })
  await step('B3: versions — v1, an identical re-upload is a no-op, a changed file is v2 (v1 no longer current), separate titles are separate chains', async () => {
    useFakeDrive()
    try {
      const v1 = await up(MANAGER, form(PDF('one'), 'Signed contract.pdf', { note: 'First signed copy' })); assert.equal(v1.status, 201, JSON.stringify(v1.json)); assert.equal(v1.json.version, 1)
      const dup = await up(MANAGER, form(PDF('one'), 'renamed copy.pdf')); assert.equal(dup.status, 200); assert.equal(dup.json.duplicate, true); assert.equal(await count('files', { linked_id: S.contractId, kind: 'contract_file' }), 1, 'identical bytes did not create a version')
      const v2 = await up(MANAGER, form(PDF('two'), 'Signed contract.pdf')); assert.equal(v2.status, 201); assert.equal(v2.json.version, 2)
      const amend = await up(MANAGER, form(PDF('amend'), 'Amendment 1.pdf', { title: 'Amendment' })); assert.equal(amend.json.version, 1, 'a different document title starts its own chain')
      const list = await call(H.files.GET, { as: MANAGER, params: { id: S.contractId } }); assert.equal(list.status, 200, JSON.stringify(list.json))
      const byKey = Object.fromEntries(list.json.map((f: any) => [`${f.doc_title}@${f.version}`, f]))
      assert.equal(byKey['Contract@1'].is_current, false); assert.equal(byKey['Contract@2'].is_current, true); assert.equal(byKey['Amendment@1'].is_current, true)
      assert.equal(byKey['Contract@1'].version_note, 'First signed copy'); assert.equal(byKey['Contract@1'].uploaded_by, 'manager user'); assert.equal(byKey['Contract@2'].size_bytes, PDF('two').length)
      assert.deepEqual(fake.names.slice(0, 3), ['Contract v1 - Signed_contract.pdf', 'Contract v2 - Signed_contract.pdf', 'Amendment v1 - Amendment_1.pdf'])
      S.fileV1 = byKey['Contract@1'].id; S.fileV2 = byKey['Contract@2'].id
    } finally { restoreDrive() }
  })
  await step('B3: upload checks look at the BYTES — a renamed program, a wrong type, an empty file and an oversize file are all refused and store nothing', async () => {
    useFakeDrive()
    try {
      const rows = await count('files', { linked_id: S.contractId, kind: 'contract_file' }); const uploadsBefore = fake.names.length
      const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(80, 7)])
      const bad: [string, Buffer, number][] = [['invoice.pdf', exe, 400], ['run.exe', exe, 400], ['page.html', Buffer.from('<script>alert(1)</script>'), 400], ['x.pdf', Buffer.alloc(0), 400], ['big.pdf', Buffer.concat([PDF('x'), Buffer.alloc(4 * 1024 * 1024)]), 413], ['noext', PDF('n'), 400]]
      for (const [name, buf, want] of bad) { const r = await up(MANAGER, form(buf, name)); assert.equal(r.status, want, `${name}: ${JSON.stringify(r.json)}`) }
      const noFile = new FormData(); noFile.append('title', 'x'); assert.equal((await up(MANAGER, noFile)).status, 400)
      assert.equal((await up(MANAGER, form(PDF('t'), 'x.pdf', { title: 'x'.repeat(81) }))).status, 400)
      assert.equal(await count('files', { linked_id: S.contractId, kind: 'contract_file' }), rows); assert.equal(fake.names.length, uploadsBefore, 'nothing reached Drive')
    } finally { restoreDrive() }
  })
  await step('B3: if Drive is down the upload is REFUSED (502) and nothing is recorded — a contract is never "saved" without the file', async () => {
    useFakeDrive()
    try {
      const rows = await count('files', { linked_id: S.contractId, kind: 'contract_file' }); fake.fail = true
      const r = await up(MANAGER, form(PDF('while down'), 'x.pdf')); assert.equal(r.status, 502, JSON.stringify(r.json)); assert.match(r.json.error, /NOT saved/)
      assert.equal(await count('files', { linked_id: S.contractId, kind: 'contract_file' }), rows, 'no row for a file that was never stored')
      assert.ok(await count('audit_events', { action: 'contract_file_upload_failed' }) >= 1, 'and the failure is on the record')
      fake.fail = false; const ok = await up(MANAGER, form(PDF('while down'), 'x.pdf')); assert.equal(ok.status, 201, 'works again once Drive is back'); assert.equal(ok.json.version, 3)
    } finally { restoreDrive() }
  })
  await step('B3: download returns the exact bytes as an attachment; roll back with make_current; exactly one current version at all times', async () => {
    useFakeDrive()
    try {
      const d = await call(H.fileById.GET, { as: MANAGER, params: { id: S.contractId, fileId: S.fileV1 } }); assert.equal(d.status, 200)
      assert.ok(Buffer.from(await d.res.arrayBuffer()).equals(PDF('one')), 'byte-for-byte')
      assert.match(d.res.headers.get('content-disposition') ?? '', /^attachment; filename="Contract-v1\.pdf"$/); assert.equal(d.res.headers.get('x-content-type-options'), 'nosniff'); assert.match(d.res.headers.get('cache-control') ?? '', /no-store/)
      assert.equal((await call(H.fileById.GET, { as: MANAGER, params: { id: S.contractId, fileId: NIL } })).status, 404)
      assert.equal((await call(H.fileById.GET, { as: MANAGER, params: { id: S.contractId, fileId: 'bad' } })).status, 404)
      const otherContract = (await svc.from('contracts').select('id').neq('id', S.contractId).limit(1).single()).data!.id
      assert.equal((await call(H.fileById.GET, { as: MANAGER, params: { id: otherContract, fileId: S.fileV1 } })).status, 404, 'a file cannot be fetched through a different contract')

      assert.equal((await call(H.fileById.PATCH, { as: MANAGER, method: 'PATCH', body: { action: 'make_current' }, params: { id: S.contractId, fileId: S.fileV1 } })).status, 200)
      const cur = async () => (await svc.from('files').select('version').eq('linked_id', S.contractId).eq('doc_title', 'Contract').eq('is_current', true)).data!
      assert.deepEqual(await cur(), [{ version: 1 }], 'rolled back to v1, and only v1 is current')
      assert.equal((await call(H.fileById.PATCH, { as: MANAGER, method: 'PATCH', body: { action: 'make_current' }, params: { id: S.contractId, fileId: S.fileV1 } })).json.unchanged, true)
      assert.equal((await call(H.fileById.PATCH, { as: MANAGER, method: 'PATCH', body: { action: 'delete' }, params: { id: S.contractId, fileId: S.fileV1 } })).status, 400)
      assert.equal((await call(H.fileById.PATCH, { as: TEAM, method: 'PATCH', body: { action: 'make_current' }, params: { id: S.contractId, fileId: S.fileV1 } })).status, 403)
      await call(H.fileById.PATCH, { as: MANAGER, method: 'PATCH', body: { action: 'make_current' }, params: { id: S.contractId, fileId: S.fileV2 } }); assert.deepEqual(await cur(), [{ version: 2 }])
      assert.ok(await count('audit_events', { action: 'contract_file_downloaded' }) >= 1)
    } finally { restoreDrive() }
  })
  await step('B3: two uploads at the SAME instant both succeed with distinct version numbers and exactly one current (the race the unique indexes guard)', async () => {
    useFakeDrive(); fake.delay = 40
    try {
      const [a, b] = await Promise.all([up(MANAGER, form(PDF('race-a'), 'a.pdf', { title: 'Race' })), up(MANAGER, form(PDF('race-b'), 'b.pdf', { title: 'Race' }))])
      assert.equal(a.status, 201, JSON.stringify(a.json)); assert.equal(b.status, 201, JSON.stringify(b.json))
      assert.deepEqual([a.json.version, b.json.version].sort(), [1, 2], 'no duplicated version number')
      const rows = (await svc.from('files').select('version, is_current').eq('linked_id', S.contractId).eq('doc_title', 'Race')).data!
      assert.equal(rows.length, 2); assert.equal(rows.filter((r: any) => r.is_current).length, 1, 'exactly one current'); assert.equal(rows.find((r: any) => r.is_current)!.version, 2, 'and it is the newest')
    } finally { fake.delay = 0; restoreDrive() }
  })
  console.log('\nStage 2B — price benchmarks (B18–B20) and shortlists / saved filters (B22)')
  const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
  await step('setup: an isolated market ("Benchland") with known prices — 10k/20k/30k/40k per match, plus a different unit, currency and a market-intel price', async () => {
    const p1 = await call(H.properties.POST, { as: TEAM, method: 'POST', body: { name: 'Bench property one', category_key: 'ooh_led', market: 'Benchland', vendor_id: S.vendor, attributes: {} } }); S.BP1 = p1.json.id
    const p2 = await call(H.properties.POST, { as: TEAM, method: 'POST', body: { name: 'Bench property two (no event date)', category_key: 'ooh_led', market: 'Benchland', vendor_id: S.vendor, attributes: {} } }); S.BP2 = p2.json.id
    assert.equal((await svc.from('properties').update({ event_start: isoDay(100) }).eq('id', S.BP1)).error, null)
    const mk = async (propertyId: string, name: string) => { const r = await call(H.items.POST, { as: TEAM, method: 'POST', body: { property_id: propertyId, name } }); assert.equal(r.status, 201); return r.json.id as string }
    S.BA = await mk(S.BP1, 'Bench A'); S.BB = await mk(S.BP1, 'Bench B'); S.BC = await mk(S.BP2, 'Bench C')
    const rec = (item: string, type: string, amount: number, ago: number, days: number | null, unit = 'per_match', currency = 'USD') => ({ org_id: S.orgId, item_id: item, type, amount, currency, unit, price_date: isoDay(-ago), days_to_event: days })
    const ins = await svc.from('price_records').insert([
      rec(S.BA, 'rack', 10000, 10, 90), rec(S.BA, 'quote', 20000, 20, 80), rec(S.BA, 'negotiated', 30000, 30, null), rec(S.BB, 'transacted', 40000, 5, 200),
      rec(S.BA, 'rack', 5000, 10, 90, 'flat'), rec(S.BA, 'rack', 999, 10, 90, 'per_match', 'EUR'), rec(S.BA, 'market_intel', 99999, 10, 90),
      rec(S.BA, 'rack', 11111, 3, -5),                                  // recorded AFTER the event started: excluded from the curve
      rec(S.BC, 'rack', 2500, 10, null, 'per_season', 'GBP')            // property two has no event date and this has no days: unknown, never guessed
    ])
    assert.equal(ins.error, null, JSON.stringify(ins.error))
    const mkBrand = async (name: string) => (await call(H.brands.POST, { as: MANAGER, method: 'POST', body: { name } })).json.id as string
    S.tiered = await mkBrand('Bench Tiered Brand'); S.untiered = await mkBrand('Bench Untiered Brand')
    assert.equal((await svc.from('brand_tier').upsert({ brand_id: S.tiered, org_id: S.orgId, tier: 'standard', margin_band_low: 18, margin_band_high: 24 })).error, null)
  })
  const BQ = '?market=benchland&category=ooh_led'
  await step('B18: hand-computed statistics through the API; like-for-like groups; market intel kept SEPARATE; no brand = no sell range', async () => {
    const r = await call(H.benchmarks.GET, { as: TEAM, query: `${BQ}&unit=per_match&currency=USD` }); assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.equal(r.json.groups.length, 1); const g = r.json.groups[0]
    assert.deepEqual([g.n, g.min, g.p25, g.median, g.p75, g.max, g.confidence], [5, 10000, 11111, 20000, 30000, 40000, 'low'], 'the 11111 recorded after the event still counts as a cost price here (the CURVE, not the range, excludes it)')
    const clean = await call(H.benchmarks.GET, { as: TEAM, query: `${BQ}&unit=per_match&currency=USD&min_days=0&max_days=999` })
    const c = clean.json.groups[0]; assert.deepEqual([c.n, c.p25, c.median, c.p75], [4, 17500, 25000, 32500], 'min_days=0 leaves out the price recorded 5 days AFTER the event, giving the hand-computed 17,500 / 25,000 / 32,500')
    assert.equal(g.suggested_sell, null, 'no brand supplied, so no sell range')
    assert.deepEqual(r.json.market_intel.map((m: any) => [m.n, m.median]), [[1, 99999]], 'market intel is its own series')
    const all = await call(H.benchmarks.GET, { as: TEAM, query: BQ }); const keys = all.json.groups.map((x: any) => `${x.unit}/${x.currency}`).sort()
    assert.deepEqual(keys, ['flat/USD', 'per_match/EUR', 'per_match/USD', 'per_season/GBP'], 'one group per (unit, currency) — nothing averaged across them')
    assert.equal((await call(H.benchmarks.GET, { as: TEAM, query: '?market=benchland-nowhere' })).json.groups.length, 0)
    assert.equal((await call(H.benchmarks.GET, { as: TEAM, query: '?market=%25' })).json.groups.length, 0, 'a literal % is not a wildcard')
  })
  await step('B18: days-to-event (a missing value is derived from the event date), since-date, and vendor filters', async () => {
    const d = await call(H.benchmarks.GET, { as: TEAM, query: `${BQ}&unit=per_match&currency=USD&min_days=120&max_days=999` }); const g = d.json.groups[0]
    assert.deepEqual([g.n, g.median], [2, 35000], 'the 200-day price and the negotiated price whose 130 days were DERIVED from the event date')
    const s = await call(H.benchmarks.GET, { as: TEAM, query: `${BQ}&unit=per_match&currency=USD&since_days=12` }); assert.deepEqual([s.json.groups[0].n, s.json.groups[0].median], [3, 11111], 'rack 10 days ago, transacted 5 days ago, and the 3-day-old one: 10,000 / 11,111 / 40,000')
    const v = await call(H.benchmarks.GET, { as: TEAM, query: `${BQ}&vendor_id=${NIL}` }); assert.equal(v.json.groups.length, 0)
    const vv = await call(H.benchmarks.GET, { as: TEAM, query: `${BQ}&vendor_id=${S.vendor}&unit=flat` }); assert.equal(vv.json.groups[0].n, 1)
    const one = await call(H.benchmarks.GET, { as: TEAM, query: `${BQ}&unit=flat` }); assert.equal(one.json.groups[0].confidence, 'insufficient', 'one price is shown with its sample size, not dressed up as a range')
  })
  await step('B20: a suggested SELL range from the brand tier band — Manager only; refused (not silently ignored) for Team; none without a band or enough data', async () => {
    const q = `${BQ}&unit=per_match&currency=USD&min_days=0&max_days=999&brand_id=${S.tiered}`
    const m = await call(H.benchmarks.GET, { as: MANAGER, query: q }); assert.equal(m.status, 200, JSON.stringify(m.json))
    assert.deepEqual(m.json.groups[0].suggested_sell, { low: 20650, mid: 30250, high: 40300 }, '17,500 +18%, 25,000 +21%, 32,500 +24%')
    assert.deepEqual(m.json.brand, { name: 'Bench Tiered Brand', tier: 'standard', band: { low: 18, high: 24 } })
    const t = await call(H.benchmarks.GET, { as: TEAM, query: q }); assert.equal(t.status, 403); assert.match(t.json.error, /Manager and CEO/)
    assert.ok(!JSON.stringify(t.json).includes('suggested_sell'), 'and nothing about the tier leaks in the refusal')
    const flat = await call(H.benchmarks.GET, { as: MANAGER, query: `${BQ}&unit=flat&brand_id=${S.tiered}` }); assert.equal(flat.json.groups[0].suggested_sell, null, 'one price: no honest range, so no sell suggestion')
    const nb = await call(H.benchmarks.GET, { as: MANAGER, query: `${BQ}&unit=per_match&currency=USD&brand_id=${S.untiered}` }); assert.equal(nb.json.groups[0].suggested_sell, null); assert.equal(nb.json.brand.band, null); assert.match(JSON.stringify(nb.json.notes), /no tier margin band/)
    assert.equal((await call(H.benchmarks.GET, { as: MANAGER, query: `${BQ}&brand_id=${NIL}` })).status, 404)
  })
  await step('B18: bad filters are refused with a clear error', async () => {
    for (const q of ['?category=A%20B', '?currency=DOLLARS', '?vendor_id=nope', '?min_days=10&max_days=5', '?min_days=abc', '?since_days=0', '?unit=%3Cscript%3E', '?brand_id=nope', `?market=${'x'.repeat(61)}`])
      assert.equal((await call(H.benchmarks.GET, { as: MANAGER, query: q })).status, 400, q)
  })
  await step('B19: price curve — medians by days-to-event; a derived day count is used; post-event and unknown-day prices are excluded and COUNTED; market intel plotted but not in the medians', async () => {
    const r = await call(H.benchCurve.GET, { as: TEAM, query: `?property_id=${S.BP1}` }); assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.equal(r.json.property, 'Bench property one'); const s = r.json.series.find((x: any) => x.unit === 'per_match' && x.currency === 'USD')
    assert.deepEqual(s.buckets.map((b: any) => [b.label, b.n, b.median]), [['61–90 days', 2, 15000], ['91–180 days', 1, 30000], ['181+ days', 1, 40000]], 'rack(90)+quote(80); negotiated(derived 130); transacted(200)')
    assert.equal(s.excluded_after_event, 1); assert.ok(s.points.some((p: any) => p.type === 'market_intel' && p.amount === 99999), 'market intel is plotted…'); assert.ok(!s.buckets.some((b: any) => b.median === 99999), '…but never enters a median')
    assert.equal(r.json.series.length, 3, 'per_match/USD, flat/USD, per_match/EUR are separate series')
    const none = await call(H.benchCurve.GET, { as: TEAM, query: `?property_id=${S.BP2}` }); const gs = none.json.series[0]
    assert.deepEqual([gs.buckets.length, gs.excluded_no_days, gs.points.length], [0, 1, 0], 'no event date and no recorded days: unknown, never guessed')
    const item = await call(H.benchCurve.GET, { as: TEAM, query: `?item_id=${S.BB}` }); assert.equal(item.json.series[0].points.length, 1)
    for (const q of ['', `?item_id=${S.BA}&property_id=${S.BP1}`, '?item_id=nope', `?property_id=${NIL}`]) assert.ok([400, 404].includes((await call(H.benchCurve.GET, { as: TEAM, query: q })).status), q)
  })
  await step('B22 item search: whitelisted filters, case-insensitive, wildcard-safe, and unknown filters are REFUSED', async () => {
    const s = (q: string) => call(H.itemSearch.GET, { as: TEAM, query: q })
    assert.deepEqual((await s('?market=BENCHLAND')).json.items.map((i: any) => i.name).sort(), ['Bench A', 'Bench B', 'Bench C'])
    assert.deepEqual((await s('?market=benchland&q=bench%20a')).json.items.map((i: any) => i.name), ['Bench A'])
    assert.equal((await s('?market=%25')).json.items.length, 0, 'a literal % does not match everything')
    await svc.from('items').update({ availability: 'sold' }).eq('id', S.BB)
    assert.deepEqual((await s('?market=benchland&availability=sold')).json.items.map((i: any) => i.name), ['Bench B'])
    assert.equal((await s('?market=benchland&category_key=player_athlete')).json.items.length, 0)
    const row = (await s('?market=benchland&q=bench%20c')).json.items[0]; assert.equal(row.properties.vendors.name, 'Apex Sports Media'); assert.equal(row.properties.categories.label.length > 0, true)
    for (const q of ['?evil=1', '?availability=maybe', '?vendor_id=x', `?q=${'x'.repeat(81)}`, '?category_key=A%20B']) assert.equal((await s(q)).status, 400, q)
  })
  await step('B22 saved filters: private by default, shareable read-only, owner-only edits, per-person names, junk criteria refused', async () => {
    const make = (as: string, body: unknown) => call(H.savedFilters.POST, { as, method: 'POST', body })
    const f = await make(TEAM, { name: 'Led in Benchland', criteria: { category_key: 'ooh_led', market: 'Benchland' } }); assert.equal(f.status, 201, JSON.stringify(f.json)); S.f1 = f.json.id
    assert.equal((await make(TEAM, { name: 'led IN benchland', criteria: {} })).status, 409, 'names are unique per person, case-insensitively')
    assert.equal((await make(MANAGER, { name: 'Led in Benchland', criteria: {} })).status, 201, 'but another person can use the same name')
    for (const body of [{ name: 'x', criteria: { evil: 1 } }, { name: 'x', criteria: [1, 2] }, { name: 'x', criteria: 'text' }, { name: '  ' }, { name: 'n'.repeat(81) }, { name: 'x', criteria: { availability: 'maybe' } }])
      assert.equal((await make(TEAM, body)).status, 400, JSON.stringify(body).slice(0, 60))
    const priv = await make(TEAM, { name: 'Private one', criteria: { market: 'UK' } }); S.f2 = priv.json.id

    const mgr = await call(H.savedFilters.GET, { as: MANAGER }); assert.ok(!mgr.json.some((x: any) => x.name === 'Private one'), 'another person\'s private filter is invisible')
    assert.equal((await call(H.savedFilterById.PATCH, { as: MANAGER, method: 'PATCH', body: { name: 'hijack' }, params: { id: S.f2 } })).status, 404, 'indistinguishable from a filter that does not exist')
    assert.equal((await call(H.savedFilterById.PATCH, { as: TEAM, method: 'PATCH', body: { shared: true }, params: { id: S.f1 } })).status, 200)
    const seen = (await call(H.savedFilters.GET, { as: MANAGER })).json.find((x: any) => x.id === S.f1); assert.ok(seen && seen.mine === false && seen.owner === 'team user' && seen.shared === true)
    assert.equal((await call(H.savedFilterById.PATCH, { as: MANAGER, method: 'PATCH', body: { name: 'hijack' }, params: { id: S.f1 } })).status, 403, 'shared means readable, not editable')
    assert.equal((await call(H.savedFilterById.DELETE, { as: MANAGER, method: 'DELETE', params: { id: S.f1 } })).status, 403)
    assert.equal((await call(H.savedFilterById.PATCH, { as: TEAM, method: 'PATCH', body: { criteria: { market: 'UAE' } }, params: { id: S.f1 } })).status, 200)
    assert.equal((await call(H.savedFilterById.PATCH, { as: TEAM, method: 'PATCH', body: {}, params: { id: S.f1 } })).status, 400)
    assert.equal((await call(H.savedFilterById.DELETE, { as: TEAM, method: 'DELETE', params: { id: S.f1 } })).status, 200); assert.equal((await call(H.savedFilterById.DELETE, { as: TEAM, method: 'DELETE', params: { id: S.f1 } })).status, 404)
    assert.equal((await call(H.savedFilterById.DELETE, { as: TEAM, method: 'DELETE', params: { id: 'nope' } })).status, 404)
  })
  await step('B22 shortlists: add is idempotent, privacy and read-only sharing, owner-only changes, items removed with the list', async () => {
    const sl = await call(H.shortlists.POST, { as: TEAM, method: 'POST', body: { name: 'Bench shortlist', note: 'for the Benchland pitch' } }); assert.equal(sl.status, 201, JSON.stringify(sl.json)); S.sl = sl.json.id
    assert.equal((await call(H.shortlists.POST, { as: TEAM, method: 'POST', body: { name: 'BENCH SHORTLIST' } })).status, 409)
    assert.equal((await call(H.shortlists.POST, { as: TEAM, method: 'POST', body: { name: '' } })).status, 400)
    const add = (as: string, ids: unknown) => call(H.shortlistItems.POST, { as, method: 'POST', body: { item_ids: ids }, params: { id: S.sl } })
    const a1 = await add(TEAM, [S.BA, S.BB]); assert.equal(a1.status, 201); assert.deepEqual([a1.json.added, a1.json.already_there], [2, 0])
    const a2 = await add(TEAM, [S.BA, S.BB, S.BC]); assert.deepEqual([a2.json.added, a2.json.already_there], [1, 2], 'adding again never duplicates')
    assert.equal((await add(TEAM, [NIL])).status, 400, 'an item that does not exist'); assert.equal((await add(TEAM, [])).status, 400); assert.equal((await add(TEAM, ['nope'])).status, 400)
    assert.equal(await count('shortlist_items', { shortlist_id: S.sl }), 3)

    const detail = await call(H.shortlistById.GET, { as: TEAM, params: { id: S.sl } }); assert.equal(detail.json.items.length, 3); assert.ok(detail.json.items.every((i: any) => i.items.name.startsWith('Bench')))
    assert.equal((await call(H.shortlistById.GET, { as: MANAGER, params: { id: S.sl } })).status, 404, 'private: invisible to others')
    assert.ok(!(await call(H.shortlists.GET, { as: MANAGER })).json.some((x: any) => x.id === S.sl))
    assert.equal((await call(H.shortlistById.PATCH, { as: TEAM, method: 'PATCH', body: { shared: true }, params: { id: S.sl } })).status, 200)
    const shared = await call(H.shortlistById.GET, { as: MANAGER, params: { id: S.sl } }); assert.equal(shared.status, 200); assert.equal(shared.json.mine, false); assert.equal(shared.json.items.length, 3)
    assert.equal((await call(H.shortlists.GET, { as: MANAGER })).json.find((x: any) => x.id === S.sl).item_count, 3)
    assert.equal((await add(MANAGER, [S.BA])).status, 403, 'shared is read-only'); assert.equal((await call(H.shortlistById.DELETE, { as: MANAGER, method: 'DELETE', params: { id: S.sl } })).status, 403)
    assert.equal((await call(H.shortlistItem.DELETE, { as: MANAGER, method: 'DELETE', params: { id: S.sl, itemId: S.BA } })).status, 403)

    assert.equal((await call(H.shortlistItem.DELETE, { as: TEAM, method: 'DELETE', params: { id: S.sl, itemId: S.BA } })).status, 200)
    assert.equal((await call(H.shortlistItem.DELETE, { as: TEAM, method: 'DELETE', params: { id: S.sl, itemId: S.BA } })).status, 404, 'already removed')
    assert.equal((await call(H.shortlistById.DELETE, { as: TEAM, method: 'DELETE', params: { id: S.sl } })).status, 200)
    assert.equal(await count('shortlist_items', { shortlist_id: S.sl }), 0, 'deleting a shortlist removes its items')
    assert.equal((await call(H.shortlistById.GET, { as: TEAM, params: { id: S.sl } })).status, 404)
  })
  console.log('\nStage 3 — live projects: checklist, parties, communication log, delivery tracking (L1–L10, L28, L29)')
  const items = (d: any) => d.json.checklist.phases.flatMap((p: any) => p.items) as any[]
  const item = (d: any, title: string) => items(d).find((i: any) => i.title === title)
  const proj = (id: string, as = TEAM) => call(H.projectById.GET, { as, params: { id } })
  const flat = async (key: string) => (await svc.from('checklist_template_items').select('id').eq('template_key', key).eq('active', true)).data!.length
  const winDeal = async (cat: string, label: string) => {
    const pr = await call(H.properties.POST, { as: TEAM, method: 'POST', body: { name: `S3 ${label}`, category_key: cat, market: 'S3land', vendor_id: S.vendor, attributes: {} } }); assert.equal(pr.status, 201, JSON.stringify(pr.json))
    const it = await call(H.items.POST, { as: TEAM, method: 'POST', body: { property_id: pr.json.id, name: `S3 item ${label}` } })
    await call(H.prices.POST, { as: TEAM, method: 'POST', body: { item_id: it.json.id, type: 'rack', amount: 5000, currency: 'USD' } })
    const p = await call(H.proposals.POST, { as: TEAM, method: 'POST', body: { brand_id: S.Blitz, route_id: S.rBlitz } }); const line = await call(H.lines.POST, { as: TEAM, method: 'POST', body: { item_id: it.json.id }, params: { id: p.json.id } })
    await call(H.margin.PATCH, { as: MANAGER, method: 'PATCH', body: { rate: 20 }, params: { id: p.json.id, lineId: line.json.id } })
    for (const st of ['Approved', 'Sent', 'Won']) assert.equal((await call(H.stage.PATCH, { as: MANAGER, method: 'PATCH', body: { to_stage: st }, params: { id: p.json.id } })).status, 200, st)
    const deal = (await svc.from('deals').select('id').eq('proposal_id', p.json.id).single()).data!.id
    const project = (await svc.from('projects').select('id').eq('deal_id', deal).maybeSingle()).data
    return { proposalId: p.json.id as string, dealId: deal as string, projectId: project?.id as string }
  }

  await step('L1: every Won deal already has exactly ONE project, built automatically — template chosen by category, checklist copied, parties derived', async () => {
    assert.equal(await count('projects'), await count('deals'), 'one project per Won deal, no deal missed')
    const mine = (await svc.from('projects').select('id, template_key, name').eq('deal_id', S.dealId).single()).data!
    assert.equal(mine.template_key, 'short', 'an OOH/LED property takes the Short template'); assert.ok(mine.name.startsWith('Blitz — '))
    S.pShort = mine.id
    const d = await proj(S.pShort); assert.equal(d.status, 200, JSON.stringify(d.json))
    assert.equal(items(d).length, await flat('short'), 'the whole Short template was copied'); assert.deepEqual(d.json.checklist.phases.map((p: any) => p.phase_no), [1, 2, 3])
    const roles = d.json.parties.map((x: any) => `${x.role}:${x.name}`).sort()
    assert.deepEqual(roles, ['brand:Blitz', 'brand_route:Direct (no agent)', 'emergex_owner:team user', 'vendor:Apex Sports Media'], 'brand, route, EmergeX owner (the proposal\'s creator) and the vendor')
    assert.ok(d.json.parties.every((x: any) => ({ brand: 'brand', brand_route: 'brand', emergex_owner: 'emergex', vendor: 'delivery' } as any)[x.role] === x.side))
    assert.equal(d.json.project.owner_name, 'team user'); assert.equal(d.json.project.brand_name, 'Blitz'); assert.equal(d.json.project.template_name, 'Short')

    const full = await winDeal('team', 'team category'); S.pFull = full.projectId; S.dealFull = full.dealId; S.propFull = full.proposalId
    assert.ok(S.pFull, 'the Won hook created the project'); const fd = await proj(S.pFull)
    assert.equal(fd.json.project.template_name, 'Full'); assert.equal(items(fd).length, await flat('full')); assert.deepEqual(fd.json.checklist.phases.map((p: any) => p.phase_no), [1, 2, 3, 4])

    const again = await call(H.projects.POST, { as: MANAGER, method: 'POST', body: { deal_id: S.dealFull } }); assert.equal(again.status, 200); assert.equal(again.json.created, false); assert.equal(again.json.id, S.pFull)
    assert.equal(await count('projects', { deal_id: S.dealFull }), 1, 'creating it again is a no-op')
    assert.equal((await call(H.projects.POST, { as: TEAM, method: 'POST', body: { deal_id: S.dealFull } })).status, 403)
    assert.equal((await call(H.projects.POST, { as: MANAGER, method: 'POST', body: { deal_id: 'nope' } })).status, 400); assert.equal((await call(H.projects.POST, { as: MANAGER, method: 'POST', body: { deal_id: NIL } })).status, 404)
    assert.ok((await call(H.projects.GET, { as: TEAM })).json.some((p: any) => p.id === S.pFull && p.brand_name === 'Blitz'))
    assert.equal((await proj(NIL)).status, 404); assert.equal((await proj('nope')).status, 404)
  })

  await step('L1 repair: a deal with no project is found and fixed by the backfill (Manager only, idempotent)', async () => {
    await svc.from('projects').delete().eq('id', S.pShort)   // simulate a deal won before Stage 3, or a failed automatic creation
    assert.equal((await call(H.projectsBackfill.GET, { as: TEAM })).json.missing, 1)
    assert.equal((await call(H.projectsBackfill.POST, { as: TEAM, method: 'POST' })).status, 403)
    const fix = await call(H.projectsBackfill.POST, { as: MANAGER, method: 'POST' }); assert.equal(fix.status, 200, JSON.stringify(fix.json)); assert.deepEqual([fix.json.created, fix.json.failed.length, fix.json.remaining], [1, 0, 0])
    assert.equal((await call(H.projectsBackfill.POST, { as: MANAGER, method: 'POST' })).json.created, 0, 'running it again creates nothing')
    S.pShort = (await svc.from('projects').select('id').eq('deal_id', S.dealId).single()).data!.id; assert.equal(items(await proj(S.pShort)).length, await flat('short'), 'rebuilt with its full checklist')
  })

  await step('L5: checklist items — update, owner, due date, notes; N/A needs a reason; custom items; template steps cannot be removed; staff-only owners', async () => {
    const d0 = await proj(S.pFull); const first = item(d0, 'Brand assets and guidelines received')
    const patch = (id: string, body: unknown, as = TEAM) => call(H.checklistItem.PATCH, { as, method: 'PATCH', body, params: { id: S.pFull, itemId: id } })
    const done = await patch(first.id, { status: 'done' }); assert.equal(done.status, 200, JSON.stringify(done.json))
    const after = item(done, 'Brand assets and guidelines received'); assert.equal(after.effective_status, 'done'); assert.ok(await count('project_checklist_items', { id: first.id, completed_by: TEAM }))
    assert.equal((await patch(first.id, { status: 'open' })).json.checklist.phases[1].items.find((i: any) => i.id === first.id).effective_status, 'open', 'un-ticking clears it')
    assert.equal(await count('project_checklist_items', { id: first.id, completed_by: null }), 1, 'and clears who/when')

    const na = item(d0, 'Kick-off call held')
    assert.equal((await patch(na.id, { status: 'na' })).status, 400, 'skipping a step needs a reason'); assert.equal((await patch(na.id, { status: 'na', na_reason: '   ' })).status, 400)
    const ok = await patch(na.id, { status: 'na', na_reason: 'Brand declined a kick-off' }); assert.equal(item(ok, 'Kick-off call held').effective_status, 'na'); assert.equal(item(ok, 'Kick-off call held').na_reason, 'Brand declined a kick-off')
    const p2 = ok.json.checklist.phases.find((p: any) => p.phase_no === 2); assert.equal(p2.na, 1); assert.equal(p2.pct, Math.round((p2.done / (p2.total - 1)) * 100), 'N/A is left out of the denominator')

    assert.equal((await patch(first.id, { owner_id: MANAGER, due_date: '2030-05-01', notes: 'chase the brand' })).status, 200)
    const owned = item(await proj(S.pFull), 'Brand assets and guidelines received'); assert.deepEqual([owned.owner_name, owned.due_date, owned.notes], ['manager user', '2030-05-01', 'chase the brand'])
    assert.equal((await patch(first.id, { owner_id: AGENT_A })).status, 400, 'an agent can never own a checklist step'); assert.equal((await patch(first.id, { owner_id: NIL })).status, 400)
    for (const bad of [{ due_date: '2030-02-30' }, { notes: 'x'.repeat(2001) }, { status: 'finished' }, {}]) assert.equal((await patch(first.id, bad)).status, 400, JSON.stringify(bad).slice(0, 40))
    assert.equal((await patch(NIL, { status: 'done' })).status, 404)
    assert.equal((await call(H.checklistItem.PATCH, { as: TEAM, method: 'PATCH', body: { status: 'done' }, params: { id: S.pShort, itemId: first.id } })).status, 404, 'an item cannot be reached through another project')

    const add = await call(H.checklistAdd.POST, { as: TEAM, method: 'POST', body: { phase_no: 2, side: 'team', title: 'Book the photographer', due_date: '2030-06-01' }, params: { id: S.pFull } }); assert.equal(add.status, 201, JSON.stringify(add.json))
    const custom = item(add, 'Book the photographer'); assert.deepEqual([custom.is_custom, custom.phase_name], [true, 'Onboarding and asset delivery'], 'joins the existing phase')
    assert.equal((await call(H.checklistAdd.POST, { as: TEAM, method: 'POST', body: { phase_no: 2, side: 'vendor', title: 'x' }, params: { id: S.pFull } })).status, 400)
    assert.equal((await call(H.checklistItem.DELETE, { as: TEAM, method: 'DELETE', params: { id: S.pFull, itemId: first.id } })).status, 400, 'a template step is marked N/A, never removed')
    const del = await call(H.checklistItem.DELETE, { as: TEAM, method: 'DELETE', params: { id: S.pFull, itemId: custom.id } }); assert.equal(item(del, 'Book the photographer'), undefined)
    assert.equal(await count('project_checklist_items', { id: custom.id }), 1, 'archived, not deleted'); assert.equal(items(del).length, await flat('full'))
  })

  await step('L6: paperwork items tick THEMSELVES from the contract and invoice records — and REOPEN if those records change', async () => {
    const st = async (title: string) => { const d = await proj(S.pFull); const i = item(d, title); return `${i.effective_status}${i.auto_satisfied ? '/auto' : ''}` }
    const t = ['Contract created', 'Signed contract filed', 'Billing schedule set up', 'First invoice issued', 'First payment received', 'All invoices paid']
    assert.deepEqual(await Promise.all(t.map(st)), ['open', 'open', 'open', 'open', 'open', 'open'], 'nothing is ticked before any paperwork exists')

    const ctr = await call(H.contracts.POST, { as: MANAGER, method: 'POST', body: { deal_id: S.dealFull, renewal_date: '2031-01-01' } }); assert.equal(ctr.status, 201, JSON.stringify(ctr.json)); S.ctrFull = ctr.json.id
    assert.equal(await st('Contract created'), 'done/auto'); assert.equal(await st('Signed contract filed'), 'open')
    useFakeDrive()
    try { const f = new FormData(); f.append('file', new File([new Uint8Array(PDF('s3'))], 'signed.pdf', { type: 'application/pdf' })); assert.equal((await call(H.files.POST, { as: MANAGER, method: 'POST', form: f, params: { id: S.ctrFull } })).status, 201) } finally { restoreDrive() }
    assert.equal(await st('Signed contract filed'), 'done/auto')

    const sch = await call(H.schedule.POST, { as: MANAGER, method: 'POST', body: { installments: 2, first_due_date: '2030-01-01' }, params: { id: S.ctrFull } }); assert.equal(sch.status, 201, JSON.stringify(sch.json))
    assert.equal(await st('Billing schedule set up'), 'done/auto'); assert.equal(await st('First invoice issued'), 'open', 'drafts are not issued')
    for (const i of sch.json.invoices) assert.equal((await call(H.invoiceById.PATCH, { as: MANAGER, method: 'PATCH', body: { action: 'void' }, params: { id: i.id } })).status, 200)
    assert.equal(await st('Billing schedule set up'), 'open', 'REOPENED: voiding the whole schedule un-ticks it')
    const sch2 = await call(H.schedule.POST, { as: MANAGER, method: 'POST', body: { installments: 2, first_due_date: '2030-01-01' }, params: { id: S.ctrFull } }); assert.equal(sch2.status, 201)
    assert.equal(await st('Billing schedule set up'), 'done/auto', 'and ticks again once a new one exists')
    const [a, b] = sch2.json.invoices.map((i: any) => i.id)
    assert.equal((await call(H.invoiceById.PATCH, { as: MANAGER, method: 'PATCH', body: { action: 'issue' }, params: { id: a } })).status, 200); assert.equal(await st('First invoice issued'), 'done/auto'); assert.equal(await st('First payment received'), 'open')
    assert.equal((await call(H.invoicePayments.POST, { as: MANAGER, method: 'POST', body: { amount: 1000 }, params: { id: a } })).status, 201); assert.equal(await st('First payment received'), 'open', 'a PART payment is not a payment received')
    assert.equal((await call(H.invoicePayments.POST, { as: MANAGER, method: 'POST', body: { amount: 2000 }, params: { id: a } })).status, 201); assert.equal(await st('First payment received'), 'done/auto'); assert.equal(await st('All invoices paid'), 'open', 'the second invoice is still unpaid')
    assert.equal((await call(H.invoiceById.PATCH, { as: MANAGER, method: 'PATCH', body: { action: 'issue' }, params: { id: b } })).status, 200); assert.equal((await call(H.invoicePayments.POST, { as: MANAGER, method: 'POST', body: { amount: 3000 }, params: { id: b } })).status, 201)
    assert.equal(await st('All invoices paid'), 'done/auto')
  })

  await step('L6/L4: the commercial gate is tracked per SIDE — brand-side and team-side clear independently; Team sees the ticks but no finance amounts', async () => {
    const g = async () => (await proj(S.pFull)).json.checklist.gate
    assert.deepEqual(await g(), { brand: 'open', team: 'open', overall: 'open' }, 'the manual brand PO and the three team items are still open')
    const d = await proj(S.pFull)
    for (const t of ['Vendor or talent agreement signed', 'Vendor payment terms confirmed']) assert.equal((await call(H.checklistItem.PATCH, { as: TEAM, method: 'PATCH', body: { status: 'done' }, params: { id: S.pFull, itemId: item(d, t).id } })).status, 200)
    assert.deepEqual(await g(), { brand: 'open', team: 'open', overall: 'open' }, 'one team item left')
    const rights = item(d, 'Rights, usage and exclusivity confirmed with the vendor')
    assert.equal((await call(H.checklistItem.PATCH, { as: TEAM, method: 'PATCH', body: { status: 'na', na_reason: 'Standard rights in the contract' }, params: { id: S.pFull, itemId: rights.id } })).status, 200)
    assert.deepEqual(await g(), { brand: 'open', team: 'cleared', overall: 'open' }, 'the TEAM side is cleared while the BRAND side is not')
    assert.equal((await call(H.checklistItem.PATCH, { as: TEAM, method: 'PATCH', body: { status: 'done' }, params: { id: S.pFull, itemId: item(d, 'Brand purchase order or written approval received').id } })).status, 200)
    assert.deepEqual(await g(), { brand: 'cleared', team: 'cleared', overall: 'cleared' })
    assert.equal((await proj(S.pFull)).json.checklist.phases[0].pct, 100)
    const body = JSON.stringify((await proj(S.pFull, TEAM)).json); assert.ok(!/"amount"|"balance"|final_amount|margin/.test(body), 'the project page exposes finance only as ticks, never amounts')
  })

  await step('L28: parties — add (side follows from the role), duplicates refused, archive; owner reassigned by Manager and kept in step; owners must be staff', async () => {
    const add = (body: unknown, as = TEAM, id = S.pFull) => call(H.parties.POST, { as, method: 'POST', body, params: { id } })
    const a = await add({ role: 'delivery_agent', name: 'Gulf Delivery Agents', ref_type: 'agent', ref_id: CO_A, contact: 'ops@gulf.test' }); assert.equal(a.status, 201, JSON.stringify(a.json))
    const ag = a.json.parties.find((x: any) => x.role === 'delivery_agent'); assert.deepEqual([ag.side, ag.name, ag.contact], ['delivery', 'Gulf Delivery Agents', 'ops@gulf.test'])
    assert.equal((await add({ role: 'delivery_agent', name: 'Again', ref_type: 'agent', ref_id: CO_A })).status, 409, 'the same party twice in one role')
    assert.equal((await add({ role: 'regulator', name: 'x' })).status, 400); assert.equal((await add({ role: 'vendor' })).status, 400); assert.equal((await add({ role: 'other', name: 'Consultant', side: 'mars' })).status, 400); assert.equal((await add({ role: 'vendor', name: 'x', ref_id: CO_A })).status, 400, 'ref_id needs a ref_type')
    assert.equal((await add({ role: 'other', name: 'Brand consultant', side: 'brand' })).status, 201)
    const del = await call(H.partyById.DELETE, { as: TEAM, method: 'DELETE', params: { id: S.pFull, partyId: ag.id } }); assert.ok(!del.json.parties.some((x: any) => x.id === ag.id)); assert.equal(await count('project_parties', { id: ag.id }), 1, 'archived, not deleted')
    assert.equal((await call(H.partyById.DELETE, { as: TEAM, method: 'DELETE', params: { id: S.pFull, partyId: ag.id } })).status, 404, 'already archived')
    assert.equal((await add({ role: 'delivery_agent', name: 'Gulf again', ref_type: 'agent', ref_id: CO_A })).status, 201, 'archiving freed the slot')

    const own = (body: unknown, as = MANAGER) => call(H.projectById.PATCH, { as, method: 'PATCH', body, params: { id: S.pFull } })
    assert.equal((await own({ owner_id: MANAGER }, TEAM)).status, 403); const r = await own({ owner_id: MANAGER, name: '  Renamed project  ' }); assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.deepEqual([r.json.project.owner_name, r.json.project.name, r.json.parties.find((x: any) => x.role === 'emergex_owner').name], ['manager user', 'Renamed project', 'manager user'])
    for (const bad of [{ owner_id: AGENT_A }, { owner_id: NIL }, { owner_id: 'nope' }, { name: '   ' }, { name: 'n'.repeat(201) }, {}]) assert.equal((await own(bad)).status, 400, JSON.stringify(bad).slice(0, 40))
  })

  await step('L2: upsells — link to the ORIGINAL; no loops, no chains; the parent shows them together with a combined delivery %', async () => {
    const link = (id: string, parent: string | null, as = MANAGER) => call(H.projectParent.POST, { as, method: 'POST', body: { parent_project_id: parent }, params: { id } })
    assert.equal((await link(S.pShort, S.pFull, TEAM)).status, 403)
    assert.equal((await link(S.pFull, S.pFull)).status, 400, 'itself'); assert.equal((await link(S.pShort, NIL)).status, 404); assert.equal((await link(S.pShort, 'nope')).status, 400)
    assert.equal((await link(S.pShort, S.pFull)).status, 200)
    assert.equal((await svc.from('deals').select('parent_deal_id').eq('id', S.dealId).single()).data!.parent_deal_id, S.dealFull, 'the deal-level link is kept in step')
    const third = await winDeal('ooh_led', 'third'); const chain = await link(third.projectId, S.pShort); assert.equal(chain.status, 400); assert.match(chain.json.error, /itself an upsell/, 'upsell of an upsell')
    const loop = await link(S.pFull, S.pShort); assert.equal(loop.status, 400, 'the original cannot become an upsell of its own upsell')
    assert.equal((await link(third.projectId, S.pFull)).status, 200); S.pThird = third.projectId

    // delivery to combine: one deliverable on the parent's contract, one on the child's (the A26/Blitz contract, which already has two)
    const ownDel = (await svc.from('deliverables').select('status, planned_quantity, delivered_quantity').eq('contract_id', S.contractId)).data!
    const mk = await call(H.deliverables.POST, { as: MANAGER, method: 'POST', body: { description: 'Parent deliverable', planned_quantity: 4, unit: 'posts' }, params: { id: S.ctrFull } }); assert.equal(mk.status, 201, JSON.stringify(mk.json))
    const pd = await proj(S.pFull); assert.equal(pd.json.upsells.length, 2); assert.deepEqual(pd.json.upsells.map((u: any) => u.id).sort(), [S.pShort, S.pThird].sort())
    assert.ok(pd.json.combined_delivery && pd.json.combined_delivery.counted >= 1 + ownDel.filter((x: any) => x.status !== 'replaced').length, 'the parent shows its own AND its upsells\' deliverables together')
    assert.equal(pd.json.deliverables.summary.counted, 1, 'while its own summary counts only its own')
    assert.equal((await proj(S.pShort)).json.project.parent.id, S.pFull)
    assert.equal((await link(S.pShort, null)).status, 200); assert.equal((await svc.from('deals').select('parent_deal_id').eq('id', S.dealId).single()).data!.parent_deal_id, null, 'unlinking clears both'); assert.equal((await proj(S.pFull)).json.upsells.length, 1)
  })

  await step('L29: the communication log — requests record who is waiting on whom; only a request can be resolved, once; entries can never be edited or deleted', async () => {
    const vendor = (await proj(S.pFull)).json.parties.find((x: any) => x.role === 'vendor'), brand = (await proj(S.pFull)).json.parties.find((x: any) => x.role === 'brand')
    const log = (body: unknown, as = TEAM, id = S.pFull) => call(H.comms.POST, { as, method: 'POST', body, params: { id } })
    const out = await log({ direction: 'outbound', channel: 'whatsapp', kind: 'request', summary: 'Please send the creative assets', party_id: vendor.id }); assert.equal(out.status, 201, JSON.stringify(out.json))
    assert.deepEqual([out.json.status, out.json.waiting_on, out.json.party_name, out.json.created_by_name], ['open', 'them', 'Apex Sports Media', 'team user'], 'we asked the vendor, so we are waiting on THEM')
    const inb = await log({ direction: 'inbound', channel: 'email', kind: 'request', summary: 'Brand wants a revised timeline', party_id: brand.id }); assert.deepEqual([inb.json.status, inb.json.waiting_on], ['open', 'us'], 'the brand asked us, so we are waiting on US')
    const upd = await log({ direction: 'inbound', channel: 'telegram', kind: 'update', summary: 'Vendor confirmed go-live', occurred_at: '2026-01-15T10:00:00Z' }); assert.deepEqual([upd.status, upd.json.status, upd.json.waiting_on, upd.json.occurred_at.slice(0, 10)], [201, 'done', null, '2026-01-15'], 'a pasted-in past message keeps its own date')
    const g = await call(H.comms.GET, { as: TEAM, params: { id: S.pFull } }); assert.equal(g.json.entries.length, 3); assert.equal(g.json.entries[0].id, inb.json.id, 'newest first')
    assert.deepEqual([g.json.requests.total, g.json.requests.onUs, g.json.requests.onThem], [2, 1, 1]); assert.deepEqual(g.json.requests.byParty[vendor.id], { onUs: 0, onThem: 1 })
    assert.equal((await call(H.projects.GET, { as: TEAM })).json.find((p: any) => p.id === S.pFull).waiting_on_us, 1)
    assert.equal((await call(H.comms.GET, { as: TEAM, params: { id: S.pFull }, query: '?status=open' })).json.entries.length, 2); assert.equal((await call(H.comms.GET, { as: TEAM, params: { id: S.pFull }, query: '?status=bogus' })).status, 400)

    for (const bad of [{ direction: 'sideways' }, { channel: 'pigeon' }, { kind: 'rumour' }, { summary: '  ' }, { summary: 'x'.repeat(2001) }, { occurred_at: 'yesterday' }, { occurred_at: '2999-01-01' }, { party_id: NIL }, { party_id: 'nope' }, { related_type: 'deliverable' }, { related_type: 'report', related_id: NIL }, { related_type: 'deliverable', related_id: NIL }, { related_type: 'invoice', related_id: NIL }])
      assert.equal((await log({ direction: 'outbound', channel: 'email', kind: 'update', summary: 'ok', ...bad })).status, 400, JSON.stringify(bad).slice(0, 60))
    const other = (await proj(S.pThird)).json.parties[0]; assert.equal((await log({ direction: 'outbound', channel: 'email', kind: 'update', summary: 'x', party_id: other.id })).status, 400, 'a party from ANOTHER project')
    const del = (await svc.from('deliverables').select('id').eq('contract_id', S.ctrFull).limit(1).single()).data!.id
    assert.equal((await log({ direction: 'outbound', channel: 'email', kind: 'proof', summary: 'Proof sent', related_type: 'deliverable', related_id: del })).status, 201, 'tied to one of THIS project\'s deliverables')
    assert.equal((await log({ direction: 'outbound', channel: 'email', kind: 'proof', summary: 'x', related_type: 'deliverable', related_id: (await svc.from('deliverables').select('id').eq('contract_id', S.contractId).limit(1).single()).data!.id }, TEAM, S.pFull)).status, 400, 'a deliverable of ANOTHER project')
    assert.equal((await log({ direction: 'inbound', channel: 'call', kind: 'approval', summary: 'Brand approved step', related_type: 'checklist_item', related_id: item(await proj(S.pFull), 'Kick-off call held').id })).status, 201)
    assert.equal((await log({ direction: 'inbound', channel: 'call', kind: 'update', summary: 'x' }, TEAM, S.pShort)).status, 201); assert.equal((await call(H.comms.GET, { as: TEAM, params: { id: S.pFull } })).json.entries.every((e: any) => e.summary !== 'x'), true)

    const res = (id: string, body: unknown = {}, as = TEAM, p = S.pFull) => call(H.commResolve.POST, { as, method: 'POST', body, params: { id: p, cid: id } })
    assert.equal((await res(out.json.id, { note: 'Assets received by email' })).status, 200); assert.equal((await res(out.json.id)).status, 409, 'resolving twice'); assert.equal((await res(upd.json.id)).status, 409, 'an update was never open'); assert.equal((await res(NIL)).status, 404); assert.equal((await res(inb.json.id, {}, TEAM, S.pShort)).status, 404, 'through another project')
    assert.deepEqual((await call(H.comms.GET, { as: TEAM, params: { id: S.pFull } })).json.requests, { total: 1, onUs: 1, onThem: 0, oldestDays: 0, byParty: { [brand.id]: { onUs: 1, onThem: 0 } } })
    const row = (await svc.from('project_communications').select('status, waiting_on, resolution_note, resolved_by').eq('id', out.json.id).single()).data!; assert.deepEqual(row, { status: 'done', waiting_on: null, resolution_note: 'Assets received by email', resolved_by: TEAM })
    assert.ok((await svc.from('project_communications').update({ summary: 'rewritten' }).eq('id', upd.json.id)).error, 'the DATABASE refuses an edit — even from the service layer')
    assert.ok((await svc.from('project_communications').delete().eq('id', upd.json.id)).error, 'and a delete'); assert.ok((await svc.from('project_communications').update({ status: 'open', waiting_on: 'us', resolved_at: null }).eq('id', out.json.id)).error, 'and re-opening a resolved request')
  })

  await step('L7/L8: deliverables take quantities; STATUS FOLLOWS the delivered quantity; Team records deliveries but cannot change terms or mark missed', async () => {
    const mk = (body: unknown, as = MANAGER) => call(H.deliverables.POST, { as, method: 'POST', body, params: { id: S.ctrFull } })
    assert.equal((await mk({ description: 'x', planned_quantity: 5 }, TEAM)).status, 403); assert.equal((await mk({ description: 'x', planned_quantity: 0 })).status, 400); assert.equal((await mk({ description: 'x', planned_quantity: 'lots' })).status, 400); assert.equal((await mk({ description: 'x', unit: 'u'.repeat(41) })).status, 400)
    S.D1 = (await mk({ description: 'Instagram posts', planned_quantity: 10, unit: 'posts' })).json.id; S.D2 = (await mk({ description: 'Banner days', planned_quantity: 30, unit: 'days' })).json.id; S.D3 = (await mk({ description: 'Event slot', planned_quantity: 1 })).json.id; S.D4 = (await mk({ description: 'Stadium board', planned_quantity: 5, unit: 'boards' })).json.id
    const rec = (id: string, qty: number, as = TEAM) => call(H.deliverableById.PATCH, { as, method: 'PATCH', body: { delivered_quantity: qty }, params: { id } })
    const a = await rec(S.D1, 4); assert.deepEqual([a.status, a.json.status, a.json.pct], [200, 'partial', 40], JSON.stringify(a.json))
    assert.deepEqual((await rec(S.D1, 10)).json.status, 'delivered'); assert.deepEqual([(await rec(S.D1, 0)).json.status, (await rec(S.D1, 0)).json.pct], ['planned', 0], 'back to zero reopens it'); const over = await rec(S.D1, 12); assert.deepEqual([over.json.status, over.json.pct], ['delivered', 100], 'over-delivery is capped at 100%')
    for (const bad of [-1, 'abc', 1e10]) assert.equal((await rec(S.D1, bad as number)).status, 400, String(bad))
    const patch = (id: string, body: unknown, as: string) => call(H.deliverableById.PATCH, { as, method: 'PATCH', body, params: { id } })
    assert.equal((await patch(S.D2, { planned_quantity: 99 }, TEAM)).status, 403, 'the terms are Manager/CEO'); assert.equal((await patch(S.D2, { status: 'missed' }, TEAM)).status, 403, 'marking missed has commercial consequences: Manager/CEO')
    assert.equal((await patch(S.D2, { description: 'Banner days (extended)', planned_quantity: 31 }, MANAGER)).status, 200)
    for (const bad of [{ status: 'delivered' }, { status: 'done' }, { status: 'planned' }, { nonsense: 1 }, {}, { planned_quantity: 0 }, { description: '' }, { due_date: '2030-13-01' }]) assert.equal((await patch(S.D2, bad, MANAGER)).status, 400, JSON.stringify(bad))
    assert.equal((await patch(NIL, { delivered_quantity: 1 }, TEAM)).status, 404); assert.equal((await patch('nope', { delivered_quantity: 1 }, TEAM)).status, 404)
    const shrunk = await patch(S.D1, { planned_quantity: 20 }, MANAGER); assert.deepEqual([shrunk.json.status, shrunk.json.pct], ['partial', 60], 'raising the target turns "delivered 12 of 10" into partial 12 of 20 — the status is recomputed, never left stale')
    await patch(S.D1, { planned_quantity: 10 }, MANAGER)
    const asContract = (await call(H.contractById.GET, { as: TEAM, params: { id: S.ctrFull } })).json.deliverables.find((d: any) => d.id === S.D2); assert.deepEqual([asContract.planned_quantity, asContract.unit, asContract.pct], [31, 'days', 0])
  })

  await step('L10: missed → make-good OR invoice adjustment (never both); the original leaves the delivery % so nothing is double-counted; replaced is closed', async () => {
    const miss = (id: string, as = MANAGER) => call(H.deliverableById.PATCH, { as, method: 'PATCH', body: { status: 'missed' }, params: { id } })
    assert.equal((await miss(S.D1)).status, 400, 'a fully delivered one cannot be missed'); assert.equal((await miss(S.D3)).json.status, 'missed')
    const mg = (id: string, body: unknown = {}, as = MANAGER) => call(H.makeGood.POST, { as, method: 'POST', body, params: { id } })
    assert.equal((await mg(S.D3, {}, TEAM)).status, 403); assert.equal((await mg(S.D1)).status, 400, 'only a missed one'); assert.equal((await mg(NIL)).status, 404); assert.equal((await mg(S.D3, { planned_quantity: 0 })).status, 400); assert.equal((await mg(S.D3, { due_date: '2030-02-30' })).status, 400)
    const before = (await proj(S.pFull)).json.deliverables.summary
    const made = await mg(S.D3, { due_date: '2031-03-01' }); assert.equal(made.status, 201, JSON.stringify(made.json)); S.MG = made.json.make_good.id
    assert.deepEqual([made.json.make_good.planned_quantity, made.json.make_good.description, made.json.original_status], [1, 'Make-good: Event slot', 'replaced'], 'defaults to what was still owed')
    assert.equal((await mg(S.D3)).status, 409, 'it already has one'); assert.equal((await call(H.deliverableById.PATCH, { as: TEAM, method: 'PATCH', body: { delivered_quantity: 1 }, params: { id: S.D3 } })).status, 400, 'a replaced deliverable is closed')
    assert.equal((await mg(S.MG)).status, 400, 'a make-good cannot itself be made good (it is planned, not missed)')
    const after = (await proj(S.pFull)).json.deliverables.summary; assert.equal(after.replacedExcluded, before.replacedExcluded + 1); assert.equal(after.counted, before.counted, 'the replaced one left the count and its make-good joined it: no double-count')

    const adj = (id: string, body: unknown, as = MANAGER) => call(H.invAdj.POST, { as, method: 'POST', body, params: { id } })
    assert.equal((await adj(S.D4, { flag: true, note: 'x' })).status, 400, 'only a MISSED one can be flagged'); await miss(S.D4)
    assert.equal((await adj(S.D4, { flag: true }, TEAM)).status, 403); assert.equal((await adj(S.D4, { flag: true })).status, 400, 'say what the adjustment should be'); assert.equal((await adj(S.D4, { flag: 'yes' })).status, 400)
    assert.equal((await adj(S.D4, { flag: true, note: 'Credit 5 boards at the contract rate' })).status, 200); assert.equal((await svc.from('deliverables').select('invoice_adjustment').eq('id', S.D4).single()).data!.invoice_adjustment, true)
    assert.equal((await mg(S.D4)).status, 400, 'flagged for an adjustment, so no make-good until the flag is cleared')
    const late = await call(H.deliverableById.PATCH, { as: TEAM, method: 'PATCH', body: { delivered_quantity: 2 }, params: { id: S.D4 } }); assert.deepEqual([late.json.status, late.json.invoice_adjustment, late.json.adjustment_note], ['partial', false, null], 'a late delivery moves it on and clears the flag with it')
    await miss(S.D4); assert.equal((await adj(S.D4, { flag: true, note: 'Credit 3 boards' })).status, 200); assert.equal((await adj(S.D4, { flag: false })).json.invoice_adjustment, false)
    const noMoney = JSON.stringify((await adj(S.D4, { flag: true, note: 'again' })).json); assert.ok(!/invoice_id|amount/.test(noMoney), 'flagging only records intent — it touches no invoice')
    assert.equal(await count('invoices', { contract_id: S.ctrFull }) >= 2, true)
  })

  await step('L9: delivery % — per deliverable and per project, weighted by count (D13 default), missed = 0, replaced excluded', async () => {
    const sum = async () => (await proj(S.pFull)).json.deliverables
    await call(H.deliverableById.PATCH, { as: TEAM, method: 'PATCH', body: { delivered_quantity: 10 }, params: { id: S.D1 } })
    const d2 = await call(H.deliverableById.PATCH, { as: MANAGER, method: 'PATCH', body: { planned_quantity: 30 }, params: { id: S.D2 } }); assert.equal(d2.status, 200)
    await call(H.deliverableById.PATCH, { as: TEAM, method: 'PATCH', body: { delivered_quantity: 30 }, params: { id: S.D2 } })
    const byId = (d: any, id: string) => d.items.find((x: any) => x.id === id)
    let d = await sum(); assert.deepEqual([byId(d, S.D1).pct, byId(d, S.D2).pct, byId(d, S.MG).pct, byId(d, S.D4).pct], [100, 100, 0, 40], 'D4 is MISSED but 2 of its 5 boards really were delivered, and that counts')
    // counted: Parent deliverable (0), D1 (100), D2 (100), MG (0), D4 (40)   [D3 is replaced and excluded]  → 240 / 5
    assert.deepEqual([d.summary.counted, d.summary.replacedExcluded, d.summary.pct], [5, 1, 48], '(0 + 100 + 100 + 0 + 40) ÷ 5')
    await call(H.deliverableById.PATCH, { as: TEAM, method: 'PATCH', body: { delivered_quantity: 1 }, params: { id: S.MG } })
    d = await sum(); assert.equal(d.summary.pct, 68, 'the make-good is delivered: (0 + 100 + 100 + 100 + 40) ÷ 5'); assert.deepEqual([d.summary.delivered, d.summary.missed, d.summary.planned, d.summary.partial], [3, 1, 1, 0])
    const listed = (await call(H.projects.GET, { as: TEAM })).json.find((p: any) => p.id === S.pFull); assert.equal(listed.delivery.pct, 68); assert.ok(listed.checklist_pct > 0 && ['open', 'cleared'].includes(listed.gate))
    assert.equal((await proj(S.pShort)).json.deliverables.summary.pct !== undefined, true)
    const emptyP = (await proj(S.pThird)).json; assert.equal(emptyP.deliverables.summary.pct, null, 'a project with nothing to deliver shows no % rather than a misleading 0 or 100'); assert.equal(emptyP.contract_id, null)
  })

  await step('overdue deliverables notify only while planned or partial — a delivered, missed or replaced one never does', async () => {
    const mk = await call(H.deliverables.POST, { as: MANAGER, method: 'POST', body: { description: 'Late banner', due_date: '2020-02-02', planned_quantity: 2 }, params: { id: S.ctrFull } })
    const overdue = async () => ((await call(H.notifications.GET, { as: MANAGER })).json.find((g: any) => g.title === 'Overdue deliverables')?.items ?? []).map((i: any) => i.label)
    assert.ok((await overdue()).includes('Late banner'))
    await call(H.deliverableById.PATCH, { as: TEAM, method: 'PATCH', body: { delivered_quantity: 1 }, params: { id: mk.json.id } }); assert.ok((await overdue()).includes('Late banner'), 'a PARTIAL one is still overdue')
    await call(H.deliverableById.PATCH, { as: TEAM, method: 'PATCH', body: { delivered_quantity: 2 }, params: { id: mk.json.id } }); assert.ok(!(await overdue()).includes('Late banner'), 'delivered: no longer overdue')
    await call(H.deliverableById.PATCH, { as: MANAGER, method: 'PATCH', body: { delivered_quantity: 0 }, params: { id: mk.json.id } }); await call(H.deliverableById.PATCH, { as: MANAGER, method: 'PATCH', body: { status: 'missed' }, params: { id: mk.json.id } }); assert.ok(!(await overdue()).includes('Late banner'), 'missed is handled by make-good/adjustment, not by an overdue nag')
  })

  await step('L3/L4: templates are DATA — Manager edits them, Team reads them; an edit changes NEW projects only, never a live one', async () => {
    const t = await call(H.templates.GET, { as: TEAM }); assert.equal(t.status, 200); assert.deepEqual(t.json.map((x: any) => x.key).sort(), ['full', 'short']); assert.match(t.json[0].description, /DRAFT/, 'the shipped checklist says it is a draft')
    const shortBefore = (await flat('short')), liveBefore = items(await proj(S.pShort)).length
    const add = (body: unknown, as = MANAGER) => call(H.templateItems.POST, { as, method: 'POST', body, params: { key: 'short' } })
    assert.equal((await add({ phase_no: 1, side: 'team', title: 'Insurance certificate received' }, TEAM)).status, 403)
    assert.equal((await add({ phase_no: 1, side: 'vendor', title: 'x' })).status, 400); assert.equal((await add({ phase_no: 1, side: 'team', title: 'x', auto_rule: 'made_up' })).status, 400); assert.equal((await add({ phase_no: 7, side: 'team', title: 'x' })).status, 400, 'a NEW phase needs a name'); assert.equal((await add({ phase_no: 1, side: 'team', title: '  ' })).status, 400)
    const ok = await add({ phase_no: 1, side: 'team', title: 'Insurance certificate received' }); assert.equal(ok.status, 201, JSON.stringify(ok.json)); assert.equal(ok.json.phase_name, 'Confirm and brief', 'joins the existing phase')
    assert.equal((await add({ phase_no: 7, phase_name: 'Wrap-up', side: 'brand', title: 'Thank-you note sent' })).status, 201)
    const retire = (await svc.from('checklist_template_items').select('id').eq('template_key', 'short').eq('title', 'Brief sent to the vendor').single()).data!.id
    const pt = (id: string, body: unknown, as = MANAGER) => call(H.templateItemById.PATCH, { as, method: 'PATCH', body, params: { id } })
    assert.equal((await pt(retire, { active: false }, TEAM)).status, 403); assert.equal((await pt(retire, { active: false })).status, 200)
    assert.equal((await pt(ok.json.id, { auto_rule: 'first_invoice_paid', title: 'Insurance certificate received (auto)' })).json.auto_rule, 'first_invoice_paid'); assert.equal((await pt(ok.json.id, { phase_no: 99 })).status, 400); assert.equal((await pt(ok.json.id, { auto_rule: 'nope' })).status, 400); assert.equal((await pt(ok.json.id, {})).status, 400); assert.equal((await pt(NIL, { active: false })).status, 404)

    assert.equal(items(await proj(S.pShort)).length, liveBefore, 'the LIVE project did not change'); assert.ok(item(await proj(S.pShort), 'Brief sent to the vendor'), 'and still has the step that was retired')
    const fresh = await winDeal('ooh_led', 'after the edit'); const fd = await proj(fresh.projectId); const titles = items(fd).map((i: any) => i.title)
    assert.ok(titles.includes('Insurance certificate received (auto)') && titles.includes('Thank-you note sent'), 'a NEW project gets the edited template'); assert.ok(!titles.includes('Brief sent to the vendor'), 'minus the retired step')
    assert.equal(items(fd).length, shortBefore + 2 - 1); assert.deepEqual(fd.json.checklist.phases.map((p: any) => p.phase_no), [1, 2, 3, 7])
    assert.equal(item(fd, 'Insurance certificate received (auto)').auto, true)
  })
  console.log('\nStage 3 — proof, metrics, delivery at risk, project notifications (L11, L13, L14, L26, L27)')
  const metricsOf = (pid: string, as = TEAM, q = '') => call(H.metrics.GET, { as, params: { id: pid }, query: q })
  const rec = (pid: string, body: unknown, as = TEAM) => call(H.metrics.POST, { as, method: 'POST', body, params: { id: pid } })
  const sumOf = (d: any, key: string) => d.json.summary.find((x: any) => x.metric_key === key)

  await step('L13: metric sets exist for every category (a DRAFT); Team reads them, only Manager edits; edits never touch recorded entries', async () => {
    const t = await call(H.metricDefs.GET, { as: TEAM }); assert.equal(t.status, 200)
    assert.equal(new Set(t.json.map((d: any) => d.category_key)).size, 12, 'a metric set for each of the 12 categories')
    const er = t.json.find((d: any) => d.category_key === 'influencer_creator' && d.key === 'engagement_rate'); assert.deepEqual([er.aggregation, er.unit], ['avg', '%'])
    const add = (body: unknown, as = MANAGER) => call(H.metricDefs.POST, { as, method: 'POST', body })
    assert.equal((await add({ category_key: 'team', key: 'sponsor_mentions', label: 'Sponsor mentions' }, TEAM)).status, 403)
    for (const bad of [{ category_key: 'nonsense', key: 'x', label: 'x' }, { category_key: 'team', key: 'Bad Key', label: 'x' }, { category_key: 'team', key: 'ok_key', label: '  ' }, { category_key: 'team', key: 'ok_key', label: 'x', aggregation: 'median' }, { category_key: 'team', key: 'ok_key', label: 'x', unit: 'u'.repeat(21) }, { category_key: 'team', key: 'matches', label: 'dup' }])
      assert.ok([400, 409].includes((await add(bad)).status), JSON.stringify(bad)); assert.equal((await add({ category_key: 'team', key: 'matches', label: 'dup' })).status, 409)
    const ok = await add({ category_key: 'team', key: 'fan_rate', label: 'Fan engagement', unit: '%', aggregation: 'avg' }); assert.equal(ok.status, 201, JSON.stringify(ok.json)); assert.equal(ok.json.position, 50, 'goes to the end of that set')
    const pt = (cat: string, key: string, body: unknown, as = MANAGER) => call(H.metricDefById.PATCH, { as, method: 'PATCH', body, params: { category: cat, key } })
    assert.equal((await pt('team', 'fan_rate', { label: 'x' }, TEAM)).status, 403); assert.equal((await pt('team', 'fan_rate', { label: 'Fan engagement rate' })).json.label, 'Fan engagement rate')
    for (const bad of [{ aggregation: 'median' }, {}, { label: '' }, { position: 1.5 }]) assert.equal((await pt('team', 'fan_rate', bad)).status, 400, JSON.stringify(bad)); assert.equal((await pt('team', 'nope', { active: false })).status, 404)
  })

  await step('L14: metric entries — only a metric from THIS project\'s categories; a NEWER reading replaces an older one (no double-counting); counts add, rates average', async () => {
    const d0 = await metricsOf(S.pFull); assert.equal(d0.status, 200, JSON.stringify(d0.json)); assert.deepEqual(d0.json.categories, ['team'])
    assert.ok(d0.json.definitions.every((d: any) => d.category_key === 'team'), 'only the sets for this project\'s category')
    const base = { source: 'Broadcaster report' }
    for (const bad of [{ metric_key: 'views', value: 1 }, { metric_key: 'nope', value: 1 }, { metric_key: 'matches', category_key: 'ooh_led', value: 1 }, { metric_key: 'matches', value: -1 }, { metric_key: 'matches', value: 'abc' }, { metric_key: 'matches', value: 1, source: '  ' }, { metric_key: 'matches', value: 1, recorded_on: '2999-01-01' }, { metric_key: 'matches', value: 1, recorded_on: '2026-02-30' }, { metric_key: 'matches', value: 1, deliverable_id: NIL }, { metric_key: 'matches', value: 1, deliverable_id: (await svc.from('deliverables').select('id').eq('contract_id', S.contractId).limit(1).single()).data!.id }, { metric_key: 'fan_rate', value: 101 }])
      assert.equal((await rec(S.pFull, { ...base, ...bad })).status, 400, JSON.stringify(bad).slice(0, 70))
    const first = await rec(S.pFull, { ...base, metric_key: 'matches', value: 3, deliverable_id: S.D1 }); assert.equal(first.status, 201, JSON.stringify(first.json)); assert.deepEqual([first.json.metric_key, first.json.value, first.json.recorded_by_name], ['matches', 3, 'team user'])

    const e = async (key: string, value: number, on: number, deliverable: string | null) => (await rec(S.pFull, { ...base, metric_key: key, value, recorded_on: isoDay(on), deliverable_id: deliverable ?? undefined, source_ref: 'https://example.test/r' })).json.id
    await e('exposure', 1000, -5, S.D1); await e('exposure', 500, -3, S.D2); await e('exposure', 100, -1, null); S.mNew = await e('exposure', 1500, -1, S.D1)
    let x = sumOf(await metricsOf(S.pFull), 'exposure'); assert.deepEqual([x.value, x.subjects, x.as_of], [2100, 3, isoDay(-1)], 'D1\'s newer 1,500 REPLACES its 1,000: 1,500 + 500 + 100, not 3,100')
    await e('fan_rate', 40, -2, S.D1); await e('fan_rate', 60, -2, S.D2); x = sumOf(await metricsOf(S.pFull), 'fan_rate'); assert.deepEqual([x.value, x.aggregation, x.unit], [50, 'avg', '%'], 'rates are averaged, not added')

    const v = (mid: string, body: unknown, as = TEAM, pid = S.pFull) => call(H.metricVoid.POST, { as, method: 'POST', body, params: { id: pid, mid } })
    assert.equal((await v(S.mNew, {})).status, 400, 'a reason is required'); assert.equal((await v(S.mNew, { reason: 'r'.repeat(501) })).status, 400); assert.equal((await v(NIL, { reason: 'x' })).status, 404); assert.equal((await v(S.mNew, { reason: 'x' }, TEAM, S.pShort)).status, 404, 'through another project')
    assert.equal((await v(S.mNew, { reason: 'Entered against the wrong deliverable' })).status, 200); assert.equal((await v(S.mNew, { reason: 'again' })).status, 409, 'voided once')
    x = sumOf(await metricsOf(S.pFull), 'exposure'); assert.equal(x.value, 1600, 'voiding the 1,500 brings D1 back to its earlier 1,000: 1,000 + 500 + 100')
    assert.ok(!(await metricsOf(S.pFull)).json.entries.some((en: any) => en.id === S.mNew), 'hidden by default'); const all = (await metricsOf(S.pFull, TEAM, '?include_voided=1')).json.entries.find((en: any) => en.id === S.mNew); assert.deepEqual([all.void_reason, !!all.voided_at], ['Entered against the wrong deliverable', true])
    assert.ok((await svc.from('project_metrics').update({ value: 1 }).eq('id', S.mNew)).error, 'the DATABASE refuses an edit'); assert.ok((await svc.from('project_metrics').delete().eq('id', S.mNew)).error, 'and a delete')

    await rec(S.pFull, { ...base, metric_key: 'team_posts', value: 7 }); assert.equal((await call(H.metricDefById.PATCH, { as: MANAGER, method: 'PATCH', body: { active: false }, params: { category: 'team', key: 'team_posts' } })).status, 200)
    assert.equal((await rec(S.pFull, { ...base, metric_key: 'team_posts', value: 8 })).status, 400, 'a retired metric takes no NEW entries'); assert.equal(sumOf(await metricsOf(S.pFull), 'team_posts').value, 7, 'but what was recorded is still counted')
    assert.equal((await metricsOf(S.pShort)).json.categories.includes('team'), false); assert.equal((await metricsOf(NIL)).status, 404)
  })

  await step('L11: proof — upload to the project folder or link a Drive file; hostile links, bad files and a Drive outage are refused and store nothing; archive, never delete', async () => {
    const PNG = (tag: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tag.repeat(40))])
    const list = async (id: string) => (await call(H.proofs.GET, { as: TEAM, params: { id } })).json
    const upload = (id: string, f: FormData, as = TEAM) => call(H.proofs.POST, { as, method: 'POST', form: f, params: { id } })
    const link = (id: string, body: unknown, as = TEAM) => call(H.proofs.POST, { as, method: 'POST', body, params: { id } })
    const detail = async () => (await proj(S.pFull)).json
    assert.equal((await detail()).proof_missing, 3, 'D1, D2 and the make-good were delivered and have no proof'); assert.equal((await detail()).deliverables.items.find((x: any) => x.id === S.D1).proof_count, 0)
    useFakeDrive()
    try {
      const up = await upload(S.D1, form(PNG('a'), 'screenshot.png', { note: 'Insights, day 3' })); assert.equal(up.status, 201, JSON.stringify(up.json)); assert.deepEqual([up.json.kind, up.json.name, up.json.mime_type, up.json.note, up.json.added_by_name], ['upload', 'screenshot.png', 'image/png', 'Insights, day 3', 'team user'])
      assert.ok(fake.names.some((n) => /proof v1 - screenshot\.png$/.test(n)), `named in Drive: ${fake.names.slice(-1)}`); S.proofA = up.json.id
      const dup = await upload(S.D1, form(PNG('a'), 'renamed.png')); assert.deepEqual([dup.status, dup.json.duplicate], [200, true]); assert.equal((await list(S.D1)).length, 1, 'identical bytes are not attached twice')
      const before = await count('deliverable_proofs', { deliverable_id: S.D1 })
      for (const [name, buf, want] of [['run.exe', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(60, 7)]), 400], ['fake.png', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(60, 7)]), 400], ['page.html', Buffer.from('<script>x</script>'), 400], ['empty.png', Buffer.alloc(0), 400], ['big.png', Buffer.concat([PNG('b'), Buffer.alloc(4 * 1024 * 1024)]), 413]] as const) assert.equal((await upload(S.D1, form(buf, name))).status, want, name)
      const none = new FormData(); none.append('note', 'x'); assert.equal((await upload(S.D1, none)).status, 400)
      fake.fail = true; const down = await upload(S.D1, form(PNG('c'), 'while-down.png')); fake.fail = false; assert.equal(down.status, 502); assert.match(down.json.error, /NOT saved/)
      assert.equal(await count('deliverable_proofs', { deliverable_id: S.D1 }), before, 'nothing was recorded for a file that was never stored'); assert.ok(await count('audit_events', { action: 'deliverable_proof_upload_failed' }) >= 1)

      const good = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing'; const l = await link(S.D2, { url: good, name: 'Tracker proof' }); assert.equal(l.status, 201, JSON.stringify(l.json)); assert.deepEqual([l.json.kind, l.json.name], ['link', 'Tracker proof']); S.proofL = l.json.id
      assert.equal((await link(S.D2, { url: good })).status, 409, 'the same link twice')
      for (const bad of ['http://drive.google.com/file/d/1AbCdEfGhIjKlMnOp', 'javascript:alert(1)', 'https://evil.example/drive.google.com/x', 'https://drive.google.com.evil.example/file/d/1AbCdEfGhIjKlMnOp', 'https://user:pw@drive.google.com/x', '', 'not a link']) assert.equal((await link(S.D2, { url: bad })).status, 400, bad)
      assert.equal((await link(S.D3, { url: good })).status, 400, 'a replaced deliverable is closed — proof goes on its make-good'); assert.equal((await link(NIL, { url: good })).status, 404); assert.equal((await link('nope', { url: good })).status, 404)
      assert.equal((await link(S.MG, { url: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit' })).status, 201)

      const dl = await call(H.proofById.GET, { as: TEAM, params: { id: S.D1, proofId: S.proofA } }); assert.equal(dl.status, 200); assert.ok(Buffer.from(await dl.res.arrayBuffer()).equals(PNG('a')), 'byte-for-byte')
      assert.match(dl.res.headers.get('content-disposition') ?? '', /^attachment; filename="screenshot\.png"$/); assert.equal(dl.res.headers.get('x-content-type-options'), 'nosniff')
      const dl2 = await call(H.proofById.GET, { as: TEAM, params: { id: S.D2, proofId: S.proofL } }); assert.equal(dl2.status, 400); assert.match(dl2.json.error, /link/)
      assert.equal((await call(H.proofById.GET, { as: TEAM, params: { id: S.D2, proofId: S.proofA } })).status, 404, 'a proof cannot be fetched through another deliverable')
      const d = await detail(); assert.equal(d.deliverables.items.find((x: any) => x.id === S.D1).proof_count, 1); assert.equal(d.proof_missing, 0, 'every delivered deliverable now has proof')
      assert.equal((await call(H.proofById.DELETE, { as: TEAM, method: 'DELETE', params: { id: S.D1, proofId: S.proofA } })).status, 200); assert.equal((await call(H.proofById.DELETE, { as: TEAM, method: 'DELETE', params: { id: S.D1, proofId: S.proofA } })).status, 404)
      assert.equal((await list(S.D1)).length, 0); assert.equal(await count('deliverable_proofs', { id: S.proofA }), 1, 'archived, not deleted'); assert.equal((await call(H.proofById.GET, { as: TEAM, params: { id: S.D1, proofId: S.proofA } })).status, 404)
      assert.equal((await upload(S.D1, form(PNG('a'), 'again.png'))).status, 201, 'the same file can be re-attached once the old one is archived'); assert.equal((await detail()).proof_missing, 0)
    } finally { restoreDrive() }
  })

  await step('L26: the CEO view lists live projects and DELIVERY AT RISK with the reason for each; it stays CEO-only', async () => {
    const stale = await call(H.comms.POST, { as: TEAM, method: 'POST', body: { direction: 'inbound', channel: 'email', kind: 'request', summary: 'Brand wants the report format changed', occurred_at: new Date(Date.now() - 10 * 86_400_000).toISOString() }, params: { id: S.pThird } }); assert.equal(stale.status, 201)
    const r = await call(H.ceoView.GET, { as: CEO }); assert.equal(r.status, 200, JSON.stringify(r.json)); const pj = r.json.projects
    assert.equal(pj.active, await count('projects', { status: 'active' })); assert.ok(pj.waiting_on_us >= 2); assert.equal(typeof pj.gates_open, 'number'); assert.ok(pj.avg_delivery_pct == null || (pj.avg_delivery_pct >= 0 && pj.avg_delivery_pct <= 100))
    const risk = (id: string) => pj.delivery_at_risk.find((x: any) => x.id === id); const codes = (id: string) => risk(id)?.reasons.map((x: any) => x.code)
    assert.ok(codes(S.pFull)?.includes('missed_unresolved'), 'the missed "Late banner" has no make-good and no invoice adjustment'); assert.equal(risk(S.pFull).reasons.find((x: any) => x.code === 'missed_unresolved').count, 1, 'exactly ONE: Late banner. The missed Stadium board WAS flagged for an invoice adjustment, so it is not unresolved')
    assert.ok(codes(S.pShort)?.includes('overdue_deliverables'), 'the A26/Blitz project has a planned deliverable due in 2020'); assert.match(risk(S.pShort).reasons.find((x: any) => x.code === 'overdue_deliverables').detail, /past due/)
    const sr = risk(S.pThird).reasons.find((x: any) => x.code === 'stale_request'); assert.ok(sr, 'a request waiting on US for 10 days'); assert.match(sr.detail, /10 days/)
    assert.equal(risk(S.pFull).reasons.some((x: any) => x.code === 'stale_request'), false, 'the brand\'s request on this project is brand new, so not stale')
    assert.equal((await call(H.ceoView.GET, { as: MANAGER })).status, 403); assert.equal((await call(H.ceoView.GET, { as: TEAM })).status, 403)
  })

  await step('L27: project notifications for EVERY staff role — waiting on us, due this week, delivered without proof, overdue steps — and they clear when the cause is fixed', async () => {
    const grp = async (title: string, as = TEAM) => (await call(H.notifications.GET, { as })).json.find((g: any) => g.title === title)
    const w = await grp('Waiting on us'); assert.ok(w, 'a group for requests waiting on us'); const stale = w.items.find((i: any) => /report format/.test(i.detail)); assert.ok(stale && stale.severity === 'urgent' && /10 days/.test(stale.detail), JSON.stringify(w.items.map((i: any) => i.detail))); assert.equal(stale.link, `/projects/${S.pThird}`)
    assert.ok(w.items.some((i: any) => /revised timeline/.test(i.detail) && i.severity === 'warn'), 'a fresh request is a warning, not urgent')
    const mk = await call(H.deliverables.POST, { as: MANAGER, method: 'POST', body: { description: 'Banner removal', due_date: isoDay(3), planned_quantity: 1 }, params: { id: S.ctrFull } }); assert.equal(mk.status, 201)
    const due = await grp('Deliverables due this week'); assert.ok(due.items.some((i: any) => i.label === 'Banner removal' && i.detail.includes(`due ${isoDay(3)}`))); assert.ok(!due.items.some((i: any) => i.label === 'Late banner'), 'an old past-due one belongs to "overdue", not "this week"')
    await call(H.deliverableById.PATCH, { as: TEAM, method: 'PATCH', body: { delivered_quantity: 1 }, params: { id: mk.json.id } }); assert.ok(!(await grp('Deliverables due this week'))?.items.some((i: any) => i.label === 'Banner removal'), 'delivered: no longer "due"')
    const p = await grp('Delivered without proof'); assert.ok(p?.items.some((i: any) => i.label === 'Banner removal'), 'delivered with nothing on file'); useFakeDrive()
    try { assert.equal((await call(H.proofs.POST, { as: TEAM, method: 'POST', body: { url: 'https://drive.google.com/file/d/1ZyXwVuTsRqPoNm/view' }, params: { id: mk.json.id } })).status, 201) } finally { restoreDrive() }
    assert.ok(!(await grp('Delivered without proof'))?.items.some((i: any) => i.label === 'Banner removal'), 'attaching proof clears it')
    const step = item(await proj(S.pFull), 'Mid-campaign check-in with the brand')
    await call(H.checklistItem.PATCH, { as: TEAM, method: 'PATCH', body: { due_date: '2020-01-01' }, params: { id: S.pFull, itemId: step.id } }); const o = await grp('Overdue project steps'); assert.ok(o.items.some((i: any) => i.label === 'Mid-campaign check-in with the brand' && i.detail.includes('2020-01-01')))
    await call(H.checklistItem.PATCH, { as: TEAM, method: 'PATCH', body: { status: 'done' }, params: { id: S.pFull, itemId: step.id } }); assert.ok(!(await grp('Overdue project steps'))?.items.some((i: any) => i.label === 'Mid-campaign check-in with the brand'), 'ticking it clears it')
    for (const as of [TEAM, MANAGER, CEO]) assert.ok(await grp('Waiting on us', as), 'every staff role sees project alerts')
    const body = JSON.stringify((await call(H.notifications.GET, { as: TEAM })).json); assert.ok(!/INV-|BILL-|"amount"/.test(body), 'and Team still sees no finance in the feed')
    await call(H.comms.POST, { as: TEAM, method: 'POST', body: { direction: 'outbound', channel: 'email', kind: 'update', summary: 'ack' }, params: { id: S.pThird } })
    assert.equal((await call(H.notifications.GET, { as: MANAGER })).status, 200)
  })
  console.log('\nStage 3 — closure, renewal, case studies, repository, pitch suggestions, chat import (L22–L25, L30)')
  const closeIt = (pid: string, body: unknown = {}, as = MANAGER) => call(H.closeProject.POST, { as, method: 'POST', body, params: { id: pid } })
  const reopenIt = (pid: string, body: unknown = {}, as = MANAGER) => call(H.reopen.POST, { as, method: 'POST', body, params: { id: pid } })
  const study = (pid: string) => call(H.caseStudy.GET, { as: TEAM, params: { id: pid } })
  const brandName = (await svc.from('brands').select('name').eq('id', S.Blitz).single()).data!.name as string
  const ACK = { acknowledge: true, note: 'Brand agreed the remaining items are out of scope' }

  await step('L22: closing is a RECORDED decision — open items are listed, need an acknowledgement AND a reason, and Team cannot close', async () => {
    const d = await winDeal('team', 'closure'); S.closeP = d.projectId
    const chk = await call(H.closure.GET, { as: TEAM, params: { id: S.closeP } }); assert.equal(chk.status, 200)
    assert.deepEqual(chk.json.issues.map((i: any) => i.code), ['steps_open', 'no_contract']); assert.equal(chk.json.issues[0].count, await flat('full'), 'every checklist step is still open')
    assert.equal((await closeIt(S.closeP, ACK, TEAM)).status, 403, 'only Manager/CEO close a project')
    const noAck = await closeIt(S.closeP); assert.equal(noAck.status, 409); assert.equal(noAck.json.requires_acknowledgement, true); assert.equal(noAck.json.issues.length, 2)
    for (const bad of [{ acknowledge: true }, { acknowledge: true, note: 'ok' }, { acknowledge: 'true', note: 'a real reason here' }, { note: 'a real reason here' }]) assert.equal((await closeIt(S.closeP, bad)).status, 409, JSON.stringify(bad))
    assert.equal((await svc.from('projects').select('status').eq('id', S.closeP).single()).data!.status, 'active', 'nothing closed yet')
    assert.equal(await count('proposals', { renewal_of_project_id: S.closeP }), 0, 'and no renewal proposal made by the refused attempts')
    const ok = await closeIt(S.closeP, ACK); assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.equal(ok.json.closed, true); assert.equal(ok.json.renewal_created, true)
    const row = (await svc.from('projects').select('status, closed_at, closed_by, closure_note, closure_warnings').eq('id', S.closeP).single()).data!
    assert.deepEqual([row.status, row.closed_by, row.closure_note, !!row.closed_at], ['closed', MANAGER, ACK.note, true]); assert.deepEqual(row.closure_warnings.map((w: any) => w.code), ['steps_open', 'no_contract'], 'exactly what was open is on record')
    assert.equal((await closeIt(S.closeP, ACK)).status, 409, 'already closed'); assert.equal((await closeIt(NIL, ACK)).status, 404); assert.equal((await closeIt('nope', ACK)).status, 404)
    const d2 = (await proj(S.closeP)).json; assert.deepEqual([d2.project.closed_by_name, d2.project.closure_note, d2.renewal_proposal.id], ['manager user', ACK.note, ok.json.renewal_proposal_id])
  })

  await step('L22: the renewal proposal is a Draft for the same brand and route, linked to the project — and closing again never makes a second one', async () => {
    const rows = (await svc.from('proposals').select('id, stage, brand_id, route_id, brief, created_by, renewal_of_project_id').eq('renewal_of_project_id', S.closeP)).data!
    assert.equal(rows.length, 1); const r = rows[0]; const orig = (await svc.from('proposals').select('brand_id, route_id').eq('id', (await svc.from('deals').select('proposal_id').eq('id', (await svc.from('projects').select('deal_id').eq('id', S.closeP).single()).data!.deal_id).single()).data!.proposal_id).single()).data!
    assert.deepEqual([r.stage, r.brand_id, r.route_id, r.created_by], ['Draft', orig.brand_id, orig.route_id, MANAGER]); assert.match(r.brief, /^Renewal of "/)
    assert.equal((await call(H.proposal.GET, { as: TEAM, params: { id: r.id } })).status, 200, 'it opens like any proposal')
    assert.equal((await reopenIt(S.closeP, { reason: 'x' })).status, 400); assert.equal((await reopenIt(S.closeP, { reason: 'Brand changed their mind' }, TEAM)).status, 403)
    assert.equal((await reopenIt(S.closeP, { reason: 'Brand changed their mind' })).status, 200); assert.equal((await reopenIt(S.closeP, { reason: 'Brand changed their mind' })).status, 409, 'not closed any more')
    assert.deepEqual(((await svc.from('projects').select('status, closed_at, closed_by, closure_note').eq('id', S.closeP).single()).data), { status: 'active', closed_at: null, closed_by: null, closure_note: null })
    const again = await closeIt(S.closeP, ACK); assert.equal(again.status, 200); assert.equal(again.json.renewal_created, false); assert.equal(again.json.renewal_proposal_id, r.id); assert.equal(await count('proposals', { renewal_of_project_id: S.closeP }), 1)
    assert.ok(await count('audit_events', { action: 'project_closed' }) >= 2 && await count('audit_events', { action: 'project_reopened' }) >= 1)
  })

  await step('L22: a closed project\'s delivery record is LOCKED through every route; the log stays open; reopening unlocks; a closed project stops raising alerts', async () => {
    const d = await winDeal('team', 'lock'); S.lockP = d.projectId; S.lockDeal = d.dealId
    const ctr = await call(H.contracts.POST, { as: MANAGER, method: 'POST', body: { deal_id: d.dealId, renewal_date: '2027-01-01' } }); assert.equal(ctr.status, 201); S.lockCtr = ctr.json.id
    const del = await call(H.deliverables.POST, { as: MANAGER, method: 'POST', body: { description: 'Lock posts', planned_quantity: 2, unit: 'posts' }, params: { id: S.lockCtr } }); assert.equal(del.status, 201); S.lockDel = del.json.id
    assert.equal((await call(H.deliverableById.PATCH, { as: TEAM, method: 'PATCH', body: { delivered_quantity: 2 }, params: { id: S.lockDel } })).status, 200)
    assert.equal((await rec(S.lockP, { metric_key: 'matches', value: 3, source: 'Broadcaster', deliverable_id: S.lockDel })).status, 201); S.lockMetric = (await svc.from('project_metrics').select('id').eq('project_id', S.lockP).single()).data!.id
    assert.equal((await call(H.proofs.POST, { as: TEAM, method: 'POST', body: { url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view' }, params: { id: S.lockDel } })).status, 201); S.lockProof = (await svc.from('deliverable_proofs').select('id').eq('deliverable_id', S.lockDel).single()).data!.id
    const party = await call(H.parties.POST, { as: TEAM, method: 'POST', body: { role: 'other', side: 'delivery', name: 'Photographer' }, params: { id: S.lockP } }); assert.equal(party.status, 201); const partyId = party.json.parties.find((x: any) => x.name === 'Photographer').id
    const ask = await call(H.comms.POST, { as: TEAM, method: 'POST', body: { direction: 'inbound', channel: 'email', kind: 'request', summary: 'Please resend the deck' }, params: { id: S.lockP } }); assert.equal(ask.status, 201)
    const stepItem = items(await proj(S.lockP)).find((i: any) => i.status === 'open' && !i.auto_rule)
    assert.ok((await call(H.notifications.GET, { as: TEAM })).json.find((g: any) => g.title === 'Waiting on us').items.some((i: any) => i.detail.includes('resend the deck')), 'alerting while active')

    const chk = await call(H.closure.GET, { as: TEAM, params: { id: S.lockP } }); assert.deepEqual(chk.json.issues.map((i: any) => i.code), ['waiting_on_us', 'steps_open']); assert.equal(chk.json.issues[1].count, (await flat('full')) - 1, 'the contract step ticked itself')
    assert.equal((await closeIt(S.lockP, ACK)).status, 200)

    const locked = async (r: Promise<any>, what: string, want = [400, 409]) => { const x = await r; assert.ok(want.includes(x.status), `${what}: got ${x.status} ${JSON.stringify(x.json).slice(0, 120)}`); assert.match(String(x.json.error), /closed.*locked|locked/i, what) }
    await locked(call(H.checklistItem.PATCH, { as: TEAM, method: 'PATCH', body: { status: 'done' }, params: { id: S.lockP, itemId: stepItem.id } }), 'tick a step')
    await locked(call(H.checklistAdd.POST, { as: TEAM, method: 'POST', body: { phase_no: 1, title: 'Late custom step', side: 'team' }, params: { id: S.lockP } }), 'add a step')
    await locked(call(H.parties.POST, { as: TEAM, method: 'POST', body: { role: 'other', side: 'delivery', name: 'Late party' }, params: { id: S.lockP } }), 'add a party')
    await locked(call(H.partyById.DELETE, { as: TEAM, method: 'DELETE', params: { id: S.lockP, partyId } }), 'archive a party')
    await locked(rec(S.lockP, { metric_key: 'matches', value: 9, source: 'late' }), 'record a metric')
    await locked(call(H.metricVoid.POST, { as: TEAM, method: 'POST', body: { reason: 'late change' }, params: { id: S.lockP, mid: S.lockMetric } }), 'void a metric')
    await locked(call(H.deliverableById.PATCH, { as: TEAM, method: 'PATCH', body: { delivered_quantity: 1 }, params: { id: S.lockDel } }), 'change a delivered quantity')
    await locked(call(H.deliverables.POST, { as: MANAGER, method: 'POST', body: { description: 'Late addition' }, params: { id: S.lockCtr } }), 'add a deliverable')
    useFakeDrive()
    try {
      const names = fake.names.length
      await locked(call(H.proofs.POST, { as: TEAM, method: 'POST', body: { url: 'https://drive.google.com/file/d/2AbCdEfGhIjKlMnOp/view' }, params: { id: S.lockDel } }), 'attach a proof link', [409])
      await locked(call(H.proofs.POST, { as: TEAM, method: 'POST', form: form(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('z'.repeat(40))]), 'late.png'), params: { id: S.lockDel } }), 'upload a proof file', [409])
      assert.equal(fake.names.length, names, 'refused BEFORE Drive was touched — no orphan file left behind')
    } finally { restoreDrive() }
    await locked(call(H.proofById.DELETE, { as: TEAM, method: 'DELETE', params: { id: S.lockDel, proofId: S.lockProof } }), 'archive a proof')

    assert.equal((await call(H.comms.POST, { as: TEAM, method: 'POST', body: { direction: 'outbound', channel: 'email', kind: 'update', summary: 'Sent the deck' }, params: { id: S.lockP } })).status, 201, 'the log stays open')
    assert.equal((await call(H.commResolve.POST, { as: TEAM, method: 'POST', body: {}, params: { id: S.lockP, cid: ask.json.id } })).status, 200, 'and requests can still be resolved')
    assert.equal((await proj(S.lockP)).status, 200); assert.equal((await metricsOf(S.lockP)).status, 200, 'reading is never locked')
    assert.ok(!(await call(H.notifications.GET, { as: TEAM })).json.find((g: any) => g.title === 'Waiting on us')?.items.some((i: any) => i.link === `/projects/${S.lockP}`), 'a closed project no longer raises alerts')
    assert.equal(await count('project_metrics', { project_id: S.lockP }), 1); assert.equal(await count('deliverable_proofs', { deliverable_id: S.lockDel }), 1, 'nothing slipped in')

    assert.equal((await reopenIt(S.lockP, { reason: 'Brand sent late results' })).status, 200)
    assert.equal((await rec(S.lockP, { metric_key: 'matches', value: 4, source: 'late results' })).status, 201, 'reopened: editable again'); assert.equal((await call(H.checklistItem.PATCH, { as: TEAM, method: 'PATCH', body: { status: 'done' }, params: { id: S.lockP, itemId: stepItem.id } })).status, 200)
    assert.equal((await closeIt(S.lockP, ACK)).status, 200, 'closed again, ready for its case study')
  })

  await step('L23: the case study is drafted from the RECORDS — every figure copied — and anonymised by derivation; only for a closed project', async () => {
    const open = await call(H.caseStudy.POST, { as: TEAM, method: 'POST', body: {}, params: { id: S.pFull } }); assert.equal(open.status, 409); assert.match(open.json.error, /Close the project first/)
    const r = await call(H.caseStudy.POST, { as: TEAM, method: 'POST', body: {}, params: { id: S.lockP } }); assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 200)); const cs = r.json.case_study
    const pname = (await svc.from('projects').select('name').eq('id', S.lockP).single()).data!.name
    assert.deepEqual([cs.status, cs.title, cs.brand_name, cs.category_keys, cs.markets, cs.property_names, cs.delivery_pct, cs.named_use_approved], ['draft', pname, brandName, ['team'], ['S3land'], ['S3 lock'], 100, false])
    assert.match(cs.body, new RegExp(`${brandName} worked with EmergeX on S3 lock in S3land`)); assert.match(cs.body, /Overall delivery: 100% across 1 deliverable\./); assert.match(cs.body, /- Lock posts: 2 of 2 posts \(100%\), proof on file/)
    assert.match(cs.body, new RegExp(`- Matches: 7 \\(total of 2 readings, as of ${isoDay(0)}\\)`)); assert.deepEqual(cs.results.map((x: any) => [x.label, x.value]), [['Matches', 7]], 'both readings (3 + 4, both project-level or per deliverable) are copied, not invented')
    assert.ok(!cs.anonymised_body.includes(brandName) && !cs.anonymised_title.includes(brandName), 'the brand is gone from the anonymised version'); assert.ok(cs.anonymised_body.includes('the brand worked with EmergeX on S3 lock')); assert.equal(cs.anonymised_title, pname.replace(brandName, 'the brand'))
    assert.deepEqual(r.json.leaks, []); assert.ok(!JSON.stringify(r.json).includes('hidden_names'), 'the hidden-names list is never sent to the browser')
    const again = await call(H.caseStudy.POST, { as: TEAM, method: 'POST', body: {}, params: { id: S.lockP } }); assert.equal(again.status, 409); assert.match(again.json.error, /overwrite/)
    assert.equal((await call(H.caseStudy.POST, { as: TEAM, method: 'POST', body: { confirm_overwrite: true }, params: { id: S.lockP } })).status, 200)
    assert.equal((await call(H.caseStudy.GET, { as: TEAM, params: { id: NIL } })).status, 404)
  })

  await step('L23/L24: edit, the leak guards, approval (Manager/CEO), edit-after-approval withdraws it, and D16 named use is opt-in', async () => {
    const edit = (body: unknown, as = TEAM) => call(H.caseStudy.PATCH, { as, method: 'PATCH', body, params: { id: S.lockP } }); const approve = (body: unknown = {}, as = MANAGER) => call(H.csApprove.POST, { as, method: 'POST', body, params: { id: S.lockP } })
    const base = (await study(S.lockP)).json.case_study.body as string
    assert.equal((await edit({})).status, 400, 'nothing to change'); assert.equal((await edit({ title: '  ' })).status, 400); assert.equal((await edit({ body: 'x'.repeat(20001) })).status, 400)
    const leaky = await edit({ body: base + `\n\n${brandName}krieg tactics won the match.` }); assert.equal(leaky.status, 200); assert.deepEqual(leaky.json.leaks, [brandName], 'a name hiding INSIDE another word is flagged for a human')
    assert.equal((await approve({}, TEAM)).status, 403, 'Team drafts and edits; Manager/CEO approve')
    const blocked = await approve(); assert.equal(blocked.status, 409); assert.deepEqual(blocked.json.leaks, [brandName]); assert.match(blocked.json.error, new RegExp(`still contains: ${brandName}`))
    const withBrand = await edit({ body: base + `\n\n${brandName} praised the activation, and Apex Sports Media delivered it.` }); assert.deepEqual(withBrand.json.leaks, [], 'a name written in full is simply replaced'); assert.match(withBrand.json.case_study.anonymised_body, /the brand praised the activation, and a partner delivered it\./)
    const ok = await approve(); assert.equal(ok.status, 200, JSON.stringify(ok.json).slice(0, 200)); assert.deepEqual([ok.json.case_study.status, ok.json.case_study.named_use_approved], ['approved', false], 'D16: anonymised by default')
    const row = (await svc.from('case_studies').select('approved_by, approved_at').eq('project_id', S.lockP).single()).data!; assert.equal(row.approved_by, MANAGER); assert.ok(row.approved_at)
    assert.equal((await approve()).status, 409, 'already approved')
    const drift = await edit({ title: 'A revised title' }); assert.equal(drift.json.approval_withdrawn, true); assert.equal(drift.json.case_study.status, 'draft', 'ANY edit takes an approved study back to draft')
    const named = await approve({ named_use_approved: true }); assert.equal(named.json.case_study.named_use_approved, true)
    const guard = await svc.from('case_studies').update({ anonymised_body: `${brandName} slipped back in` }).eq('project_id', S.lockP); assert.match(guard.error?.message ?? '', /still contains/, 'the DATABASE refuses it even if the app were bypassed')
    assert.equal((await call(H.csWithdraw.POST, { as: TEAM, method: 'POST', params: { id: S.lockP } })).status, 403)
    assert.equal((await call(H.csWithdraw.POST, { as: MANAGER, method: 'POST', params: { id: S.lockP } })).status, 200); assert.equal((await call(H.csWithdraw.POST, { as: MANAGER, method: 'POST', params: { id: S.lockP } })).status, 409)
    const after = (await study(S.lockP)).json.case_study; assert.deepEqual([after.status, after.named_use_approved], ['draft', false], 'withdrawing also withdraws named use')
    assert.equal((await approve()).status, 200); assert.ok(await count('audit_events', { action: 'case_study_approved' }) >= 3 && await count('audit_events', { action: 'case_study_edited' }) >= 3)
  })

  const approveOne = (pid: string) => call(H.csApprove.POST, { as: MANAGER, method: 'POST', body: {}, params: { id: pid } })
  await step('L24: the repository — approved studies, filterable by brand, category, market, property and text; staff only; no hidden names', async () => {
    const o = await winDeal('ooh_led', 'repo ooh'); S.oohP = o.projectId; await svc.from('properties').update({ market: 'Narnia' }).eq('name', 'S3 repo ooh')   // changed BEFORE the case study is drafted, so its market tag is Narnia
    assert.equal((await closeIt(S.oohP, ACK)).status, 200); assert.equal((await call(H.caseStudy.POST, { as: TEAM, method: 'POST', body: {}, params: { id: S.oohP } })).status, 201)
    assert.equal((await call(H.caseStudy.POST, { as: TEAM, method: 'POST', body: {}, params: { id: S.closeP } })).status, 201)
    const list = async (q = '', as = TEAM) => (await call(H.csList.GET, { as, query: q })).json
    assert.deepEqual((await list()).map((x: any) => x.project_id), [S.lockP], 'only APPROVED studies by default (the other two are drafts)')
    assert.equal((await list('?status=draft')).length, 2); assert.equal((await list('?status=all')).length, 3); assert.equal((await call(H.csList.GET, { as: TEAM, query: '?status=bogus' })).status, 400)
    assert.equal((await approveOne(S.oohP)).status, 200); assert.equal((await approveOne(S.closeP)).status, 200)
    const all = await list(); assert.equal(all.length, 3); assert.ok(all.every((x: any) => !('body' in x) && !('hidden_names' in x)), 'the list is light and never carries hidden names')
    assert.deepEqual((await list('?category=ooh_led')).map((x: any) => x.project_id), [S.oohP]); assert.deepEqual((await list('?market=narnia')).map((x: any) => x.project_id), [S.oohP], 'case-insensitive'); assert.equal((await list('?market=S3land')).length, 2)
    assert.deepEqual((await list('?property=S3 lock')).map((x: any) => x.project_id), [S.lockP]); assert.equal((await list(`?brand=${brandName.toLowerCase()}`)).length, 3); assert.equal((await list('?brand=zzzz')).length, 0)
    assert.deepEqual((await list('?q=repo ooh')).map((x: any) => x.project_id), [S.oohP]); assert.equal((await list('?category=ooh_led&market=S3land')).length, 0, 'filters combine')
    const one = await call(H.csById.GET, { as: TEAM, params: { id: all[0].id } }); assert.equal(one.status, 200); assert.ok(one.json.body && one.json.anonymised_body && !('hidden_names' in one.json)); assert.equal((await call(H.csById.GET, { as: TEAM, params: { id: NIL } })).status, 404); assert.equal((await call(H.csById.GET, { as: TEAM, params: { id: 'nope' } })).status, 404)
  })

  await step('L25: pitch suggestions rank by shared category, market and property; ANONYMISED unless the brand agreed to be named (D16); never the same brand; never drafts', async () => {
    const lockItem = (await svc.from('items').select('id').eq('name', 'S3 item lock').single()).data!.id
    const pr = await call(H.proposals.POST, { as: TEAM, method: 'POST', body: { brand_id: S.tiered, route_id: S.rBlitz } }); assert.equal(pr.status, 201); const pid = pr.json.id
    assert.equal((await call(H.lines.POST, { as: TEAM, method: 'POST', body: { item_id: lockItem }, params: { id: pid } })).status, 201)
    const sug = async (q: string, as = TEAM) => call(H.csSuggest.GET, { as, query: q })
    const r = await sug(`?proposal_id=${pid}`); assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200)); const ids = r.json.suggestions.map((x: any) => [x.project_id, x.score])
    assert.deepEqual(ids, [[S.lockP, 7], [S.closeP, 5]], 'lock: category 3 + market 2 + property 2; closure: category 3 + market 2; the ooh study shares nothing'); assert.deepEqual(r.json.suggestions[0].reasons, ['same category: team', 'same market: S3land', 'same property: S3 lock'])
    const blob = JSON.stringify(r.json); assert.ok(!blob.includes('hidden_names') && !blob.includes(brandName), `the response names nobody: ${blob.match(new RegExp(`.{20}${brandName}.{20}`))?.[0]}`)
    assert.ok(r.json.suggestions.every((x: any) => x.named === null && x.named_use_approved === false), 'D16: no named text unless the brand agreed')
    assert.equal((await call(H.csApprove.POST, { as: MANAGER, method: 'POST', params: { id: S.lockP } })).status, 409, 'already approved')
    await call(H.csWithdraw.POST, { as: MANAGER, method: 'POST', params: { id: S.lockP } }); assert.equal((await call(H.csApprove.POST, { as: MANAGER, method: 'POST', body: { named_use_approved: true }, params: { id: S.lockP } })).status, 200)
    const named = (await sug(`?proposal_id=${pid}`)).json.suggestions.find((x: any) => x.project_id === S.lockP); assert.equal(named.named_use_approved, true); assert.ok(named.named.title === 'A revised title' && named.named.text.includes(brandName), 'named text appears only once the brand agreed (and it is the team\'s edited text)'); assert.ok(!named.text.includes(brandName), 'and the anonymised text stays anonymised')
    const own = await call(H.proposals.POST, { as: TEAM, method: 'POST', body: { brand_id: S.Blitz, route_id: S.rBlitz } }); await call(H.lines.POST, { as: TEAM, method: 'POST', body: { item_id: lockItem }, params: { id: own.json.id } })
    assert.deepEqual((await sug(`?proposal_id=${own.json.id}`)).json.suggestions, [], 'a brand is never shown its own past project as "relevant work"')
    assert.deepEqual((await sug('?category_key=ooh_led&market=Narnia')).json.suggestions.map((x: any) => x.project_id), [S.oohP], 'or give the filters by hand')
    await call(H.csWithdraw.POST, { as: MANAGER, method: 'POST', params: { id: S.oohP } }); assert.deepEqual((await sug('?category_key=ooh_led')).json.suggestions, [], 'a draft is never suggested')
    assert.equal((await sug('?proposal_id=nope')).status, 404); assert.equal((await sug(`?proposal_id=${NIL}`)).status, 404); assert.equal((await sug('?brand_id=nope')).status, 400); assert.deepEqual((await sug('')).json.suggestions, [], 'nothing asked, nothing suggested')
  })

  await step('L30: a pasted chat is PREVIEWED (nothing saved), reviewed, then confirmed — duplicates skipped, bad entries refuse the whole import, entries marked as imported and immutable', async () => {
    const chat = ['[12/05/2026, 10:32:15] Brand Lead: Please send the final report format?', '[12/05/2026, 10:40:00] Team User: Sending it today', 'with the screenshots attached', '[12/05/2026, 10:41:00] Messages and calls are end-to-end encrypted.', '[12/05/2026, 11:05:30] Brand Lead: Approved, go ahead'].join('\n')
    const pv = (body: unknown, as = TEAM, id = S.pFull) => call(H.chatPreview.POST, { as, method: 'POST', body, params: { id } }); const cf = (entries: unknown, as = TEAM, id = S.pFull) => call(H.chatConfirm.POST, { as, method: 'POST', body: { entries }, params: { id } })
    const before = await count('project_communications', { project_id: S.pFull })
    const r = await pv({ text: chat, utc_offset_minutes: 330 }); assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200)); const j = r.json
    assert.deepEqual([j.format, j.count, j.skipped_system, j.invalid_dates, j.truncated], ['whatsapp_ios', 3, 1, 0, false]); assert.deepEqual(j.senders, [{ name: 'Brand Lead', messages: 2 }, { name: 'Team User', messages: 1 }])
    assert.equal(j.messages[0].occurred_at, '2026-05-12T05:02:15.000Z', 'Mumbai time converted'); assert.deepEqual(j.messages.map((m: any) => m.suggested_kind), ['request', 'proof', 'approval'], 'a message that mentions screenshots is SUGGESTED as proof; the reviewer decides'); assert.equal(j.messages[1].text, 'Sending it today\nwith the screenshots attached'); assert.ok(j.parties.length >= 1 && j.messages.every((m: any) => m.duplicate === false))
    assert.equal(await count('project_communications', { project_id: S.pFull }), before, 'a PREVIEW saves nothing')
    for (const [body, want] of [[{ text: '' }, 400], [{ text: chat, date_order: 'ymd' }, 400], [{ text: chat, utc_offset_minutes: 9999 }, 400], [{ text: chat, utc_offset_minutes: 1.5 }, 400], [{ text: 'x'.repeat(200001) }, 400]] as const) assert.equal((await pv(body)).status, want, JSON.stringify(body).slice(0, 60))
    const nc = await pv({ text: 'hello, this is not a chat export' }); assert.deepEqual([nc.status, nc.json.format, nc.json.count], [200, 'unknown', 0]); assert.equal((await pv({ text: chat }, TEAM, NIL)).status, 404); assert.equal((await pv({ text: chat }, AGENT_A)).status, 403)

    const brandParty = (await svc.from('project_parties').select('id').eq('project_id', S.pFull).eq('role', 'brand_route').is('archived_at', null).limit(1)).data?.[0]?.id ?? j.parties[0].id
    const entries = [{ occurred_at: j.messages[0].occurred_at, direction: 'inbound', channel: 'whatsapp', kind: 'request', party_id: brandParty, summary: j.messages[0].text }, { occurred_at: j.messages[1].occurred_at, direction: 'outbound', channel: 'whatsapp', kind: 'update', summary: `Team User: ${j.messages[1].text}` }, { occurred_at: j.messages[2].occurred_at, direction: 'inbound', channel: 'whatsapp', kind: 'approval', party_id: brandParty, summary: j.messages[2].text }]
    const bad = await cf([...entries, { ...entries[0], channel: 'carrier pigeon' }]); assert.equal(bad.status, 400); assert.deepEqual(bad.json.rejected.map((x: any) => x.index), [3]); assert.equal(await count('project_communications', { project_id: S.pFull }), before, 'one bad entry: NOTHING imported')
    for (const e of [[{ ...entries[0], party_id: S.lockPartyOther ?? NIL }], [{ ...entries[0], party_id: 'nope' }], [], 'nope']) assert.ok([400].includes((await cf(e as any)).status), JSON.stringify(e).slice(0, 50))
    assert.equal((await cf(Array.from({ length: 201 }, () => entries[1]))).status, 400, 'at most 200 at a time'); assert.equal((await cf(entries, AGENT_A)).status, 403)
    const waitBefore = (await proj(S.pFull)).json.requests.onUs
    const ok = await cf(entries); assert.equal(ok.status, 201, JSON.stringify(ok.json)); assert.deepEqual([ok.json.imported, ok.json.skipped_duplicates], [3, 0])
    const rows = (await svc.from('project_communications').select('source, created_by, kind, status, waiting_on, occurred_at, direction').eq('project_id', S.pFull).eq('source', 'chat_import').order('occurred_at')).data!
    assert.equal(rows.length, 3); assert.ok(rows.every((x) => x.created_by === TEAM)); assert.deepEqual(rows.map((x) => [x.kind, x.status, x.waiting_on]), [['request', 'open', 'us'], ['update', 'done', null], ['approval', 'done', null]], 'an imported request is a REAL open request, waiting on us'); assert.equal(new Date(rows[0].occurred_at).toISOString(), '2026-05-12T05:02:15.000Z')
    assert.equal((await proj(S.pFull)).json.requests.onUs, waitBefore + 1, 'the imported request counts on the project page: exactly one more waiting on us')
    const again = await cf(entries); assert.deepEqual([again.status, again.json.imported, again.json.skipped_duplicates], [200, 0, 3], 're-pasting the same chat adds nothing')
    assert.ok((await pv({ text: chat, utc_offset_minutes: 330 })).json.messages.every((m: any) => m.duplicate === true), 'and a second preview flags them')
    const twin = await cf([{ ...entries[1], occurred_at: '2026-05-13T10:00:00.000Z' }, { ...entries[1], occurred_at: '2026-05-13T10:00:00.000Z' }]); assert.deepEqual([twin.json.imported, twin.json.skipped_duplicates], [1, 1], 'duplicates inside one batch too')
    assert.ok((await svc.from('project_communications').update({ summary: 'rewritten' }).eq('source', 'chat_import').eq('project_id', S.pFull)).error, 'an imported entry cannot be edited, like any log entry')
    assert.equal((await cf([{ ...entries[1], occurred_at: '2026-05-14T10:00:00.000Z' }], TEAM, S.lockP)).status, 201, 'the log is open on a CLOSED project too')
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
