'use client'
import { useEffect, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

interface Brand { id: string; name: string; markets: string | null; status: string | null; brand_group_id: string | null }
interface Group { id: string; name: string; brands: { id: string; name: string }[] }
interface CompetitorLink { id: string; a_name: string; b_name: string; note: string | null }
interface Agent { id: string; name: string; markets: string | null; cut_method: string; cut_pct: number; fixed_fee: number }
interface RouteRow {
  id: string; brand_id: string; route_type: string; market: string | null
  strength: number | null; reliability: number | null; status: string
  brands: { name: string } | null; agents: { name: string } | null
}
interface BrandTier { brand_id: string; tier: string; margin_band_low: number | null; margin_band_high: number | null }

export default function Brands() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [routes, setRoutes] = useState<RouteRow[]>([])
  const [tiers, setTiers] = useState<Record<string, BrandTier>>({})
  const [groups, setGroups] = useState<Group[]>([])
  const [links, setLinks] = useState<CompetitorLink[]>([])
  const [groupName, setGroupName] = useState('')
  const [compA, setCompA] = useState('')
  const [compB, setCompB] = useState('')
  const [compNote, setCompNote] = useState('')
  const [role, setRole] = useState<string | null>(null)

  const [brandName, setBrandName] = useState('')
  const [agentName, setAgentName] = useState('')
  const [selectedBrand, setSelectedBrand] = useState('')
  const [selectedAgent, setSelectedAgent] = useState('')
  const [routeType, setRouteType] = useState('direct')
  const [market, setMarket] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const supabase = supabaseBrowser()
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      const { data: profile } = await supabase.from('profiles').select('role_key').eq('id', session.user.id).single()
      setRole(profile?.role_key ?? null)
    }
    const [b, a, r, t] = await Promise.all([
      supabase.from('brands').select('id, name, markets, status, brand_group_id'),
      supabase.from('agents').select('id, name, markets, cut_method, cut_pct, fixed_fee'),
      supabase.from('routes').select('id, brand_id, route_type, market, strength, reliability, status, brands(name), agents(name)'),
      // brand_tier is Management-only via RLS — Team's query here just comes back empty, not an error.
      supabase.from('brand_tier').select('brand_id, tier, margin_band_low, margin_band_high')
    ])
    setBrands(b.data ?? [])
    const [g, l] = await Promise.all([
      fetch('/api/brand-groups').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/competitor-links').then((r) => (r.ok ? r.json() : []))
    ])
    setGroups(g); setLinks(l)
    setAgents(a.data ?? [])
    setRoutes((r.data as unknown as RouteRow[]) ?? [])
    setTiers(Object.fromEntries((t.data ?? []).map((row) => [row.brand_id, row as BrandTier])))
    if (b.data?.length && !selectedBrand) setSelectedBrand(b.data[0].id)
  }

  const canManagePricing = role === 'manager' || role === 'ceo' || role === 'management'

  async function post(url: string, method: string, body?: unknown) {
    setSaving(true); setError('')
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      await load()
      return true
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false } finally { setSaving(false) }
  }
  const createGroup = async () => { if (await post('/api/brand-groups', 'POST', { name: groupName })) setGroupName('') }
  const assignGroup = (brandId: string, groupId: string) => post(`/api/brands/${brandId}`, 'PATCH', { brand_group_id: groupId || null })
  const addCompetitor = async () => {
    const [aType, aId] = compA.split(':'); const [bType, bId] = compB.split(':')
    if (await post('/api/competitor-links', 'POST', { a_type: aType, a_id: aId, b_type: bType, b_id: bId, note: compNote || null })) { setCompA(''); setCompB(''); setCompNote('') }
  }
  const removeCompetitor = (id: string) => post(`/api/competitor-links/${id}`, 'DELETE')

  async function saveTier(brandId: string, tier: string, low: string, high: string) {
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/brands/${brandId}/tier`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, margin_band_low: Number(low), margin_band_high: Number(high) })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
  }

  async function saveAgentCut(agentId: string, cutMethod: string, cutPct: string, fixedFee: string) {
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cut_method: cutMethod, cut_pct: Number(cutPct), fixed_fee: Number(fixedFee) })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
  }


  async function createBrand() {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/brands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: brandName }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setBrandName(''); load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
  }

  async function createAgent() {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: agentName }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setAgentName(''); load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
  }

  async function createRoute() {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/routes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_id: selectedBrand, route_type: routeType, market,
          agent_id: routeType !== 'direct' ? (selectedAgent || null) : null
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMarket(''); load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
  }

  async function proposeScore(routeId: string, field: 'strength' | 'reliability', newValue: number) {
    const res = await fetch('/api/route-score-changes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route_id: routeId, field, new_value: newValue })
    })
    const data = await res.json()
    if (res.ok) alert(data.status === 'pending' ? 'Score change proposed — pending Management review.' : 'Score updated.')
    load()
  }

  return (
    <div>
      <h1 className="text-lg font-semibold mb-5">Brands &amp; Routes</h1>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-panel border border-line rounded-xl p-4">
          <div className="text-xs text-muted uppercase mb-2">New brand</div>
          <div className="flex gap-2">
            <input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Brand name" className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm flex-1" />
            <button onClick={createBrand} disabled={saving || !brandName} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">Add</button>
          </div>
        </div>

        <div className="bg-panel border border-line rounded-xl p-4">
          <div className="text-xs text-muted uppercase mb-2">New agent</div>
          <div className="flex gap-2">
            <input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="Agent name" className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm flex-1" />
            <button onClick={createAgent} disabled={saving || !agentName} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">Add</button>
          </div>
        </div>

        <div className="bg-panel border border-line rounded-xl p-4">
          <div className="text-xs text-muted uppercase mb-2">New route</div>
          <div className="flex flex-col gap-2">
            <select value={selectedBrand} onChange={(e) => setSelectedBrand(e.target.value)} className="bg-panel2 border border-line rounded-md px-2 py-2 text-sm">
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select value={routeType} onChange={(e) => setRouteType(e.target.value)} className="bg-panel2 border border-line rounded-md px-2 py-2 text-sm">
              <option value="direct">Direct</option><option value="via_agent">Via agent</option><option value="via_sub_agent">Via sub-agent</option><option value="via_partner">Via partner</option>
            </select>
            {routeType !== 'direct' && (
              <select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)} className="bg-panel2 border border-line rounded-md px-2 py-2 text-sm">
                <option value="">Select agent…</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            <div className="flex gap-2">
              <input value={market} onChange={(e) => setMarket(e.target.value)} placeholder="Market" className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm flex-1" />
              <button onClick={createRoute} disabled={saving || !selectedBrand} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">Add</button>
            </div>
          </div>
        </div>
      </div>
      {error && <div className="text-red-400 text-sm mb-4">{error}</div>}

      <h2 className="text-sm font-semibold text-muted uppercase mb-2">Brand groups</h2>
      <p className="text-xs text-muted mb-2">Brands in the same group are flagged when the same item has already gone to another brand in that group.</p>
      <div className="bg-panel border border-line rounded-xl overflow-hidden mb-6">
        <div className="p-3 flex gap-2 border-b border-line">
          <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="New group name" className="bg-panel2 border border-line rounded-md px-3 py-1.5 text-sm flex-1" />
          <button onClick={createGroup} disabled={saving || !groupName.trim()} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md text-sm disabled:opacity-40">Add group</button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {brands.map((b) => (
              <tr key={b.id} className="border-b border-line last:border-0">
                <td className="p-3">{b.name}</td>
                <td className="p-3">
                  <select value={b.brand_group_id ?? ''} onChange={(e) => assignGroup(b.id, e.target.value)} disabled={saving} className="bg-panel2 border border-line rounded px-2 py-1 text-xs">
                    <option value="">— no group —</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
            {brands.length === 0 && <tr><td className="p-4 text-center text-muted text-sm">No brands yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="text-sm font-semibold text-muted uppercase mb-2">Competing brands</h2>
      <p className="text-xs text-muted mb-2">If the same item has gone to one side in the same market, sending it to the other is flagged. Empty until you add some — with none listed, this check never fires.</p>
      <div className="bg-panel border border-line rounded-xl overflow-hidden mb-6">
        {canManagePricing && (
          <div className="p-3 flex gap-2 border-b border-line flex-wrap">
            {[[compA, setCompA], [compB, setCompB]].map(([val, set], idx) => (
              <select key={idx} value={val as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} className="bg-panel2 border border-line rounded-md px-2 py-1.5 text-sm">
                <option value="">{idx === 0 ? 'Brand or group…' : '…competes with'}</option>
                {brands.map((b) => <option key={b.id} value={`brand:${b.id}`}>{b.name}</option>)}
                {groups.map((g) => <option key={g.id} value={`brand_group:${g.id}`}>{g.name} (group)</option>)}
              </select>
            ))}
            <input value={compNote} onChange={(e) => setCompNote(e.target.value)} placeholder="Note (optional)" className="bg-panel2 border border-line rounded-md px-3 py-1.5 text-sm flex-1 min-w-[140px]" />
            <button onClick={addCompetitor} disabled={saving || !compA || !compB} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md text-sm disabled:opacity-40">Add</button>
          </div>
        )}
        <table className="w-full text-sm">
          <tbody>
            {links.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0">
                <td className="p-3">{l.a_name} <span className="text-muted">↔</span> {l.b_name}</td>
                <td className="p-3 text-muted text-xs">{l.note}</td>
                <td className="p-3 text-right">{canManagePricing && <button onClick={() => removeCompetitor(l.id)} disabled={saving} className="text-xs text-muted underline">Remove</button>}</td>
              </tr>
            ))}
            {links.length === 0 && <tr><td className="p-4 text-center text-muted text-sm">No competing brands listed.</td></tr>}
          </tbody>
        </table>
      </div>

      {canManagePricing && (
        <>
          <h2 className="text-sm font-semibold text-muted uppercase mb-2">Tiers &amp; margin bands (A2)</h2>
          <div className="bg-panel border border-line rounded-xl overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted uppercase"><tr className="border-b border-line">
                <th className="text-left p-3">Brand</th><th className="text-left p-3">Tier</th>
                <th className="text-left p-3">Band low %</th><th className="text-left p-3">Band high %</th><th className="text-left p-3"></th>
              </tr></thead>
              <tbody>
                {brands.map((b) => {
                  const t = tiers[b.id]
                  return (
                    <tr key={b.id} className="border-b border-line last:border-0">
                      <td className="p-3">{b.name}</td>
                      <td className="p-3">
                        <select defaultValue={t?.tier ?? 'standard'} id={`tier-${b.id}`} className="bg-panel2 border border-line rounded px-2 py-1 text-xs">
                          <option value="preferred">Preferred</option><option value="standard">Standard</option><option value="non_preferred">Non-preferred</option>
                        </select>
                      </td>
                      <td className="p-3"><input defaultValue={t?.margin_band_low ?? ''} id={`low-${b.id}`} type="number" className="bg-panel2 border border-line rounded px-2 py-1 text-xs w-20" /></td>
                      <td className="p-3"><input defaultValue={t?.margin_band_high ?? ''} id={`high-${b.id}`} type="number" className="bg-panel2 border border-line rounded px-2 py-1 text-xs w-20" /></td>
                      <td className="p-3">
                        <button
                          disabled={saving}
                          onClick={() => {
                            const tier = (document.getElementById(`tier-${b.id}`) as HTMLSelectElement).value
                            const low = (document.getElementById(`low-${b.id}`) as HTMLInputElement).value
                            const high = (document.getElementById(`high-${b.id}`) as HTMLInputElement).value
                            saveTier(b.id, tier, low, high)
                          }}
                          className="bg-amber text-black font-semibold px-3 py-1 rounded text-xs disabled:opacity-40"
                        >
                          Save
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <h2 className="text-sm font-semibold text-muted uppercase mb-2">Agent cut methods</h2>
          <div className="bg-panel border border-line rounded-xl overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted uppercase"><tr className="border-b border-line">
                <th className="text-left p-3">Agent</th><th className="text-left p-3">Method</th>
                <th className="text-left p-3">Cut %</th><th className="text-left p-3">Fixed fee</th><th className="text-left p-3"></th>
              </tr></thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id} className="border-b border-line last:border-0">
                    <td className="p-3">{a.name}</td>
                    <td className="p-3">
                      <select defaultValue={a.cut_method} id={`method-${a.id}`} className="bg-panel2 border border-line rounded px-2 py-1 text-xs">
                        <option value="none">None</option><option value="onTop">On top</option><option value="outOf">Out of EmergeX price</option><option value="fixedFee">Fixed fee</option>
                      </select>
                    </td>
                    <td className="p-3"><input defaultValue={a.cut_pct} id={`pct-${a.id}`} type="number" className="bg-panel2 border border-line rounded px-2 py-1 text-xs w-16" /></td>
                    <td className="p-3"><input defaultValue={a.fixed_fee} id={`fee-${a.id}`} type="number" className="bg-panel2 border border-line rounded px-2 py-1 text-xs w-20" /></td>
                    <td className="p-3">
                      <button
                        disabled={saving}
                        onClick={() => {
                          const method = (document.getElementById(`method-${a.id}`) as HTMLSelectElement).value
                          const pct = (document.getElementById(`pct-${a.id}`) as HTMLInputElement).value
                          const fee = (document.getElementById(`fee-${a.id}`) as HTMLInputElement).value
                          saveAgentCut(a.id, method, pct, fee)
                        }}
                        className="bg-amber text-black font-semibold px-3 py-1 rounded text-xs disabled:opacity-40"
                      >
                        Save
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="bg-panel border border-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted uppercase"><tr className="border-b border-line">
            <th className="text-left p-3">Brand</th><th className="text-left p-3">Route</th><th className="text-left p-3">Agent</th><th className="text-left p-3">Market</th>
            <th className="text-left p-3">Strength</th><th className="text-left p-3">Reliability</th><th className="text-left p-3">Status</th>
          </tr></thead>
          <tbody>
            {routes.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="p-3">{r.brands?.name}</td>
                <td className="p-3 capitalize">{r.route_type.replace(/_/g, ' ')}</td>
                <td className="p-3">{r.agents?.name ?? '—'}</td>
                <td className="p-3">{r.market}</td>
                <td className="p-3">
                  <select value={r.strength ?? ''} onChange={(e) => proposeScore(r.id, 'strength', Number(e.target.value))} className="bg-panel2 border border-line rounded px-1 py-0.5 text-xs">
                    <option value="">—</option>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </td>
                <td className="p-3">
                  <select value={r.reliability ?? ''} onChange={(e) => proposeScore(r.id, 'reliability', Number(e.target.value))} className="bg-panel2 border border-line rounded px-1 py-0.5 text-xs">
                    <option value="">—</option>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </td>
                <td className="p-3">{r.status}</td>
              </tr>
            ))}
            {routes.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted">No routes yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted mt-2">Changing a score here proposes it via the service layer — Team's changes land pending until Management approves.</p>
    </div>
  )
}
