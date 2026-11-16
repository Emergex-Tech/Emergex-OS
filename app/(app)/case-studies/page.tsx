'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

/* eslint-disable @typescript-eslint/no-explicit-any */
const inp = 'bg-panel2 border border-line rounded-md px-2 py-1.5 text-sm'

export default function CaseStudiesPage() {
  const [rows, setRows] = useState<any[] | null>(null); const [f, setF] = useState({ q: '', brand: '', category: '', market: '', property: '', status: 'approved' })
  const [open, setOpen] = useState<string | null>(null); const [detail, setDetail] = useState<any>(null); const [named, setNamed] = useState(false)
  const load = async () => { const sp = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => v && sp.set(k, v)); const r = await fetch(`/api/case-studies?${sp}`); setRows(r.ok ? await r.json() : []) }
  useEffect(() => { load() }, [f.status]) // eslint-disable-line react-hooks/exhaustive-deps
  async function show(id: string) { if (open === id) { setOpen(null); return } setOpen(id); setNamed(false); setDetail(null); const r = await fetch(`/api/case-studies/${id}`); if (r.ok) setDetail(await r.json()) }
  const set = (k: string, v: string) => setF({ ...f, [k]: v })
  return (<div>
    <h1 className="text-lg font-semibold mb-1">Case studies</h1>
    <p className="text-sm text-muted mb-4">The project repository: approved case studies from closed projects, tagged by brand, category, market, property and results. Pitches use the anonymised version unless the brand agreed to being named.</p>
    <div className="flex gap-2 flex-wrap mb-4"><input className={`${inp} w-52`} placeholder="Search…" value={f.q} onChange={(e) => set('q', e.target.value)} /><input className={`${inp} w-36`} placeholder="Brand" value={f.brand} onChange={(e) => set('brand', e.target.value)} />
      <input className={`${inp} w-40`} placeholder="Category key" value={f.category} onChange={(e) => set('category', e.target.value)} /><input className={`${inp} w-32`} placeholder="Market" value={f.market} onChange={(e) => set('market', e.target.value)} /><input className={`${inp} w-44`} placeholder="Property" value={f.property} onChange={(e) => set('property', e.target.value)} />
      <select className={inp} value={f.status} onChange={(e) => set('status', e.target.value)}><option value="approved">Approved</option><option value="draft">Drafts</option><option value="all">All</option></select><button onClick={load} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md text-sm">Filter</button></div>
    {rows === null ? <p className="text-muted">Loading…</p> : rows.length === 0 ? <p className="text-muted">No case studies match. They appear here once a closed project&apos;s case study is approved.</p> : (
      <div className="bg-panel border border-line rounded-xl overflow-hidden">{rows.map((s) => (<div key={s.id} className="border-b border-line last:border-0 p-3">
        <div className="flex justify-between gap-4"><button className="text-left font-semibold underline" onClick={() => show(s.id)}>{s.title}</button><span className="text-xs text-muted">{s.status === 'approved' ? (s.named_use_approved ? 'named use OK' : 'anonymised only') : 'draft'} · {s.delivery_pct != null ? `${s.delivery_pct}% delivered` : ''}</span></div>
        <div className="text-xs text-muted">{s.brand_name} · {s.category_keys.join(', ')} · {s.markets.join(', ')} · {s.property_names.join(', ')}{s.results?.length ? ' · ' + s.results.slice(0, 3).map((r: any) => `${r.label} ${Number(r.value).toLocaleString()}${r.unit === '%' ? '%' : ''}`).join(' · ') : ''} · <Link className="underline" href={`/projects/${s.project_id}`}>project</Link></div>
        {open === s.id && (detail ? (<div className="mt-3"><div className="flex gap-2 mb-2 text-sm"><button onClick={() => setNamed(false)} className={`px-2 py-1 rounded ${!named ? 'bg-amber text-black' : 'border border-line text-muted'}`}>Anonymised</button><button onClick={() => setNamed(true)} className={`px-2 py-1 rounded ${named ? 'bg-amber text-black' : 'border border-line text-muted'}`}>Named (internal)</button></div>
          <div className="font-semibold mb-1">{named ? detail.title : detail.anonymised_title}</div><pre className="whitespace-pre-wrap font-sans text-sm bg-panel2 rounded p-3">{named ? detail.body : detail.anonymised_body}</pre></div>) : <p className="text-muted mt-2">Loading…</p>)}
      </div>))}</div>)}
  </div>)
}
