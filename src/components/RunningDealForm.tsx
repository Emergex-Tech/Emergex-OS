'use client'
import { useEffect, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

/* eslint-disable @typescript-eslint/no-explicit-any */
const inp = 'bg-panel2 border border-line rounded-md px-2 py-1.5 text-sm'

/** Enter a deal that was signed before the system existed: brand, route, the inventory behind it and what the brand pays. Manager/CEO. */
export default function RunningDealForm() {
  const [open, setOpen] = useState(false); const [brands, setBrands] = useState<any[]>([]); const [routes, setRoutes] = useState<any[]>([]); const [items, setItems] = useState<any[]>([])
  const [f, setF] = useState({ brand_id: '', route_id: '', currency: 'USD', renewal_date: '', signed_on: '', terms: '' }); const [lines, setLines] = useState([{ item_id: '', sell_price: '' }]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { if (!open) return; const sb = supabaseBrowser()
    sb.from('brands').select('id, name').order('name').then(({ data }) => setBrands(data ?? []))
    sb.from('routes').select('id, brand_id, route_type, agents(name)').then(({ data }) => setRoutes(data ?? []))
    sb.from('items').select('id, name, properties(name)').order('name').limit(1000).then(({ data }) => setItems(data ?? [])) }, [open])
  const total = lines.reduce((s, l) => s + (Number(l.sell_price) || 0), 0)
  async function save() {
    setBusy(true); setErr('')
    const r = await fetch('/api/running-deals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, terms: f.terms || undefined, signed_on: f.signed_on || undefined, items: lines.filter((l) => l.item_id).map((l) => ({ item_id: l.item_id, sell_price: Number(l.sell_price || 0) })) }) })
    const j = await r.json().catch(() => ({})); setBusy(false)
    if (!r.ok) { setErr(j.error ?? 'Failed'); return } window.location.href = `/projects/${j.project_id}`
  }
  if (!open) return <button className="text-sm underline text-muted mb-4" onClick={() => setOpen(true)}>Enter a deal that is already running…</button>
  return (<div className="bg-panel border border-line rounded-xl p-4 mb-5 text-sm">
    <div className="flex justify-between mb-1"><b>Enter a deal that is already running</b><button className="text-xs underline text-muted" onClick={() => setOpen(false)}>Close</button></div>
    <p className="text-xs text-muted mb-3">For deals signed before this system. It creates the deal, its contract and a live project in one step. It is marked as entered directly, so it never counts in win-rate figures, and no cost is recorded (margin shows as unknown). The inventory item must already exist — add the vendor, property and item first if it does not.</p>
    {err && <div className="text-red-400 mb-2">{err}</div>}
    <div className="flex flex-wrap gap-2 mb-2">
      <select className={inp} value={f.brand_id} onChange={(e) => setF({ ...f, brand_id: e.target.value, route_id: '' })}><option value="">Brand…</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      <select className={inp} value={f.route_id} onChange={(e) => setF({ ...f, route_id: e.target.value })} disabled={!f.brand_id}><option value="">How they deal with us…</option>{routes.filter((r) => r.brand_id === f.brand_id).map((r) => <option key={r.id} value={r.id}>{r.route_type === 'via_agent' ? `Via ${r.agents?.name ?? 'an agent'}` : 'Direct'}</option>)}</select>
      <input className={`${inp} w-20`} value={f.currency} maxLength={3} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} title="Currency" />
      <label className="text-xs text-muted">Signed on <input type="date" className={inp} max={new Date().toISOString().slice(0, 10)} value={f.signed_on} onChange={(e) => setF({ ...f, signed_on: e.target.value })} title="So revenue is booked in the month it was really signed" /></label>
      <label className="text-xs text-muted">Contract ends / renews <input type="date" className={inp} value={f.renewal_date} onChange={(e) => setF({ ...f, renewal_date: e.target.value })} /></label></div>
    {f.brand_id && routes.filter((r) => r.brand_id === f.brand_id).length === 0 && <div className="text-xs text-amber mb-2">This brand has no route yet — add one on the brand&apos;s page first.</div>}
    {lines.map((l, i) => (<div key={i} className="flex gap-2 mb-1">
      <select className={`${inp} flex-1`} value={l.item_id} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, item_id: e.target.value } : x)))}><option value="">Inventory item…</option>{items.map((it) => <option key={it.id} value={it.id}>{it.properties?.name ? `${it.properties.name} — ` : ''}{it.name}</option>)}</select>
      <input type="number" min="0" step="any" className={`${inp} w-40`} placeholder="Price the brand pays" value={l.sell_price} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, sell_price: e.target.value } : x)))} />
      {lines.length > 1 && <button className="text-xs underline text-muted" onClick={() => setLines(lines.filter((_, j) => j !== i))}>remove</button>}</div>))}
    <button className="text-xs underline text-muted mb-2" onClick={() => setLines([...lines, { item_id: '', sell_price: '' }])}>+ another item</button>
    <textarea className={`${inp} w-full mb-2`} rows={2} placeholder="Contract terms worth keeping (exclusivity, region, image rights…) — optional" value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} />
    <div className="flex items-center gap-3"><button disabled={busy || !f.brand_id || !f.route_id || !f.renewal_date || !lines.some((l) => l.item_id)} onClick={save} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md disabled:opacity-40">Create the deal, contract and project</button><span className="text-muted">Contract value: {total.toLocaleString()} {f.currency}</span></div>
  </div>)
}
