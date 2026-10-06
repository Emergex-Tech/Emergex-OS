'use client'
import { useEffect, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

interface Group { unit: string | null; currency: string; n: number; confidence: string; min: number; p25: number; median: number; p75: number; max: number; oldest: string; newest: string; suggested_sell?: { low: number; mid: number; high: number } | null }
interface Result { groups: Group[]; market_intel: Group[]; brand: { name: string; tier: string | null; band: { low: number; high: number } | null } | null; notes: string[] }
interface Series { unit: string | null; currency: string; points: { days: number; amount: number; type: string }[]; buckets: { label: string; n: number; median: number; min: number; max: number }[]; excluded_after_event: number; excluded_no_days: number }

const CONF: Record<string, string> = { insufficient: 'text-red-400', low: 'text-amber', moderate: 'text-blue-400', good: 'text-green-400' }
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

export default function Benchmarks() {
  const [cats, setCats] = useState<{ key: string; label: string }[]>([]); const [vendors, setVendors] = useState<{ id: string; name: string }[]>([])
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]); const [props, setProps] = useState<{ id: string; name: string; market: string | null }[]>([])
  const [role, setRole] = useState<string | null>(null)
  const [f, setF] = useState({ category: '', market: '', vendor_id: '', unit: '', currency: '', min_days: '', max_days: '', since_days: '', brand_id: '' })
  const [res, setRes] = useState<Result | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const [propId, setPropId] = useState(''); const [curve, setCurve] = useState<{ property: string | null; series: Series[] } | null>(null)

  useEffect(() => {
    const sb = supabaseBrowser()
    sb.from('categories').select('key, label').order('label').then(({ data }) => setCats(data ?? []))
    sb.from('vendors').select('id, name').order('name').then(({ data }) => setVendors(data ?? []))
    sb.from('properties').select('id, name, market').order('name').limit(500).then(({ data }) => setProps(data ?? []))
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) return
      const { data: p } = await sb.from('profiles').select('role_key').eq('id', data.session.user.id).single(); setRole(p?.role_key ?? null)
      if (['manager', 'ceo', 'management'].includes(p?.role_key ?? '')) sb.from('brands').select('id, name').order('name').then(({ data: b }) => setBrands(b ?? []))
    })
  }, [])

  async function run() {
    setBusy(true); setError('')
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '') as [string, string][])
    const r = await fetch(`/api/benchmarks?${qs}`); const d = await r.json()
    if (!r.ok) { setError(d.error); setRes(null) } else setRes(d)
    setBusy(false)
  }
  async function loadCurve(id: string) { setPropId(id); if (!id) { setCurve(null); return } const r = await fetch(`/api/benchmarks/curve?property_id=${id}`); setCurve(r.ok ? await r.json() : null) }

  const inp = 'bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full'
  const canTier = ['manager', 'ceo', 'management'].includes(role ?? '')
  return (
    <div>
      <h1 className="text-lg font-semibold mb-1">Price benchmarks</h1>
      <p className="text-xs text-muted mb-4">Typical cost ranges from your own price history. Advisory only — nothing here changes a price or a proposal. Prices are never mixed across currencies or pricing units.</p>
      <div className="bg-panel border border-line rounded-xl p-4 mb-5">
        <div className="grid grid-cols-4 gap-3 mb-3">
          <div><label className="text-xs text-muted block mb-1">Category</label><select className={inp} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Any</option>{cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
          <div><label className="text-xs text-muted block mb-1">Market</label><input className={inp} value={f.market} onChange={(e) => setF({ ...f, market: e.target.value })} placeholder="e.g. UAE" /></div>
          <div><label className="text-xs text-muted block mb-1">Vendor</label><select className={inp} value={f.vendor_id} onChange={(e) => setF({ ...f, vendor_id: e.target.value })}><option value="">Any</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-2"><div><label className="text-xs text-muted block mb-1">Unit</label><input className={inp} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="per_match" /></div><div><label className="text-xs text-muted block mb-1">Currency</label><input className={inp} maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} placeholder="USD" /></div></div>
          <div><label className="text-xs text-muted block mb-1">Days to event: from</label><input type="number" className={inp} value={f.min_days} onChange={(e) => setF({ ...f, min_days: e.target.value })} /></div>
          <div><label className="text-xs text-muted block mb-1">…to</label><input type="number" className={inp} value={f.max_days} onChange={(e) => setF({ ...f, max_days: e.target.value })} /></div>
          <div><label className="text-xs text-muted block mb-1">Only prices from the last (days)</label><input type="number" className={inp} value={f.since_days} onChange={(e) => setF({ ...f, since_days: e.target.value })} /></div>
          {canTier && <div><label className="text-xs text-muted block mb-1">Suggest a sell range for brand</label><select className={inp} value={f.brand_id} onChange={(e) => setF({ ...f, brand_id: e.target.value })}><option value="">None</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
        </div>
        <button onClick={run} disabled={busy} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">{busy ? 'Working…' : 'Show benchmark'}</button>
        {error && <span className="text-red-400 text-sm ml-3">{error}</span>}
      </div>

      {res && (<>
        {res.brand && <p className="text-sm mb-3">Brand <b>{res.brand.name}</b> · tier <b>{res.brand.tier ?? '—'}</b> · {res.brand.band ? `margin band ${res.brand.band.low}%–${res.brand.band.high}%` : <span className="text-amber">no margin band set</span>}</p>}
        <div className="bg-panel border border-line rounded-xl overflow-hidden mb-3"><table className="w-full text-sm">
          <thead className="text-xs text-muted uppercase"><tr className="border-b border-line"><th className="text-left p-3">Unit · currency</th><th className="text-right p-3">Prices</th><th className="text-right p-3">Low</th><th className="text-right p-3">Typical range (25–75%)</th><th className="text-right p-3">Median</th><th className="text-right p-3">High</th>{res.brand && <th className="text-right p-3">Suggested sell</th>}</tr></thead>
          <tbody>
            {res.groups.map((g, i) => (<tr key={i} className="border-b border-line last:border-0"><td className="p-3">{g.unit ?? '—'} · {g.currency}</td>
              <td className="p-3 text-right font-mono">{g.n} <span className={`text-xs ${CONF[g.confidence]}`}>{g.confidence}</span></td>
              {g.confidence === 'insufficient' ? <td colSpan={4} className="p-3 text-right text-xs text-muted">Not enough history for a range (needs at least 3 prices){g.n ? ` — the only value is ${fmt(g.median)}` : ''}</td> : <>
                <td className="p-3 text-right font-mono">{fmt(g.min)}</td><td className="p-3 text-right font-mono">{fmt(g.p25)} – {fmt(g.p75)}</td><td className="p-3 text-right font-mono text-amber">{fmt(g.median)}</td><td className="p-3 text-right font-mono">{fmt(g.max)}</td></>}
              {res.brand && <td className="p-3 text-right font-mono text-xs">{g.suggested_sell ? `${fmt(g.suggested_sell.low)} – ${fmt(g.suggested_sell.high)} (mid ${fmt(g.suggested_sell.mid)})` : '—'}</td>}</tr>))}
            {res.groups.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted">No prices match these filters.</td></tr>}
          </tbody></table></div>
        {res.market_intel.length > 0 && <p className="text-xs text-muted mb-2">Market intel (reference only, not part of the cost range): {res.market_intel.map((m) => `${m.unit ?? '—'} · ${m.currency}: ${m.n} price${m.n === 1 ? '' : 's'}, median ${fmt(m.median)}`).join(' | ')}</p>}
        <ul className="text-xs text-muted list-disc pl-5 mb-8">{res.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      </>)}

      <h2 className="text-sm font-semibold text-muted uppercase mb-2">Price curve — how price moves as the event gets closer</h2>
      <select className={`${inp} max-w-md mb-3`} value={propId} onChange={(e) => loadCurve(e.target.value)}><option value="">Choose a property…</option>{props.map((p) => <option key={p.id} value={p.id}>{p.name}{p.market ? ` (${p.market})` : ''}</option>)}</select>
      {curve && curve.series.map((s, i) => <CurveChart key={i} s={s} />)}
      {curve && curve.series.length === 0 && <div className="text-sm text-muted">No prices recorded for this property yet.</div>}
    </div>
  )
}

function CurveChart({ s }: { s: Series }) {
  const W = 640, H = 200, pad = 40
  const maxDays = Math.max(30, ...s.points.map((p) => p.days)), maxAmt = Math.max(1, ...s.points.map((p) => p.amount))
  const x = (d: number) => pad + (1 - Math.max(0, d) / maxDays) * (W - pad - 10), y = (a: number) => H - pad - (a / maxAmt) * (H - pad - 10)
  const color: Record<string, string> = { rack: '#8aa', quote: '#6cf', negotiated: '#fb5', transacted: '#7d7', market_intel: '#d7a' }
  return (
    <div className="bg-panel border border-line rounded-xl p-4 mb-4">
      <div className="text-xs text-muted mb-2">{s.unit ?? '—'} · {s.currency} — left is far from the event, right is event day</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-2xl">
        <line x1={pad} y1={H - pad} x2={W - 10} y2={H - pad} stroke="#444" /><line x1={pad} y1={10} x2={pad} y2={H - pad} stroke="#444" />
        <text x={pad} y={H - 8} fontSize="10" fill="#888">{maxDays}d out</text><text x={W - 40} y={H - 8} fontSize="10" fill="#888">event</text><text x={2} y={14} fontSize="10" fill="#888">{fmt(maxAmt)}</text>
        {s.points.filter((p) => p.days >= 0).map((p, i) => <circle key={i} cx={x(p.days)} cy={y(p.amount)} r={4} fill={color[p.type] ?? '#aaa'}><title>{p.type}: {fmt(p.amount)} at {p.days} days</title></circle>)}
      </svg>
      <div className="text-xs text-muted flex gap-3 flex-wrap mb-2">{Object.entries(color).map(([t, c]) => <span key={t}><span style={{ color: c }}>●</span> {t.replace('_', ' ')}</span>)}</div>
      <table className="text-xs"><tbody>{s.buckets.map((b) => <tr key={b.label}><td className="pr-4 py-0.5 text-muted">{b.label}</td><td className="pr-4 font-mono">median {fmt(b.median)}</td><td className="text-muted">{b.n} price{b.n === 1 ? '' : 's'} ({fmt(b.min)}–{fmt(b.max)})</td></tr>)}</tbody></table>
      {(s.excluded_no_days > 0 || s.excluded_after_event > 0) && <p className="text-xs text-muted mt-2">Left out: {s.excluded_no_days} with no days-to-event known{s.excluded_after_event ? `, ${s.excluded_after_event} recorded after the event started` : ''}.</p>}
    </div>
  )
}
