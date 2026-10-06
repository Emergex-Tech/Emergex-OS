'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

interface Brand { id: string; name: string }
interface RouteRow { id: string; route_type: string; market: string | null; brand_id: string }
interface ProposalRow {
  id: string; stage: string; brief: string | null; budget: number | null; currency: string; created_at: string
  brands: { name: string } | null
  routes: { route_type: string; agents: { name: string } | null } | null
}

export default function Proposals() {
  const [proposals, setProposals] = useState<ProposalRow[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [routes, setRoutes] = useState<RouteRow[]>([])
  const [showNew, setShowNew] = useState(false)
  const [brandId, setBrandId] = useState('')
  const [routeId, setRouteId] = useState('')
  const [brief, setBrief] = useState('')
  const [budget, setBudget] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [alreadyShared, setAlreadyShared] = useState<{ share_id: string; at: string; item: string; route: string }[]>([])

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!showNew || !brandId) { setAlreadyShared([]); return }
    fetch(`/api/brands/${brandId}/shares`).then((r) => (r.ok ? r.json() : [])).then(setAlreadyShared)
  }, [showNew, brandId])

  async function load() {
    const supabase = supabaseBrowser()
    const [p, b, r] = await Promise.all([
      fetch('/api/proposals').then((res) => (res.ok ? res.json() : [])),
      supabase.from('brands').select('id, name'),
      supabase.from('routes').select('id, route_type, market, brand_id')
    ])
    setProposals(p)
    setBrands(b.data ?? [])
    setRoutes(r.data ?? [])
    if (b.data?.length && !brandId) setBrandId(b.data[0].id)
  }

  const routesForBrand = routes.filter((r) => r.brand_id === brandId)

  async function createProposal() {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/proposals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_id: brandId, route_id: routeId || null, brief: brief || null, budget: budget ? Number(budget) : null })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setShowNew(false); setBrief(''); setBudget(''); setRouteId('')
      load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-lg font-semibold">Proposals</h1>
        <button onClick={() => setShowNew((s) => !s)} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm">+ New proposal</button>
      </div>

      {showNew && (
        <div className="bg-panel border border-line rounded-xl p-4 mb-6">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-muted block mb-1">Brand</label>
              <select value={brandId} onChange={(e) => { setBrandId(e.target.value); setRouteId('') }} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full">
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Route</label>
              <select value={routeId} onChange={(e) => setRouteId(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full">
                <option value="">— none —</option>
                {routesForBrand.map((r) => <option key={r.id} value={r.id}>{r.route_type.replace(/_/g, ' ')} · {r.market ?? '—'}</option>)}
              </select>
            </div>
          </div>
          <div className="mb-3 text-xs">
            {alreadyShared.length === 0
              ? <span className="text-muted">Nothing has been shared with this brand yet.</span>
              : <>
                  <div className="text-amber mb-1">Already shared with this brand ({alreadyShared.length}):</div>
                  {alreadyShared.slice(0, 8).map((s) => (
                    <div key={s.share_id} className="flex justify-between py-0.5">
                      <span>{s.item}</span><span className="text-muted font-mono">{s.route} · {new Date(s.at).toLocaleDateString()}</span>
                    </div>
                  ))}
                  {alreadyShared.length > 8 && <div className="text-muted">…and {alreadyShared.length - 8} more</div>}
                </>}
          </div>
          <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Brief…" className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full h-16 mb-3" />
          <input value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Budget" type="number" className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full mb-3" />
          <button onClick={createProposal} disabled={saving || !brandId} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">
            {saving ? 'Creating…' : 'Create proposal'}
          </button>
          {error && <div className="text-red-400 text-sm mt-2">{error}</div>}
        </div>
      )}

      <div className="bg-panel border border-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted uppercase"><tr className="border-b border-line">
            <th className="text-left p-3">Brand</th><th className="text-left p-3">Route</th><th className="text-left p-3">Stage</th>
            <th className="text-left p-3">Budget</th><th className="text-left p-3">Created</th>
          </tr></thead>
          <tbody>
            {proposals.map((p) => (
              <tr key={p.id} className="border-b border-line last:border-0 cursor-pointer hover:bg-panel2">
                <td className="p-3"><Link href={`/proposals/${p.id}`} className="text-blue-400 underline">{p.brands?.name}</Link></td>
                <td className="p-3">{p.routes ? `${p.routes.route_type.replace(/_/g, ' ')}${p.routes.agents ? ' · ' + p.routes.agents.name : ''}` : 'Direct'}</td>
                <td className="p-3">{p.stage}</td>
                <td className="p-3 font-mono">{p.budget ? `${p.currency} ${p.budget.toLocaleString()}` : '—'}</td>
                <td className="p-3 font-mono text-xs">{new Date(p.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {proposals.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted">No proposals yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
