'use client'
import { useEffect, useState } from 'react'

/* eslint-disable @typescript-eslint/no-explicit-any */
const inp = 'bg-panel2 border border-line rounded-md px-2 py-1.5 text-sm'
const DIM_LABEL: Record<string, string> = { brand: 'Brand', agent: 'Agent', market: 'Market', category: 'Category', vendor: 'Vendor', owner: 'Owner' }
const money = (v: number | null | undefined) => (v == null ? '—' : Math.round(v).toLocaleString())
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`)

export default function RevenuePage() {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState(''); const [q, setQ] = useState({ from: '', to: '', currency: '' }); const [dim, setDim] = useState('brand'); const [msg, setMsg] = useState('')
  const load = async (over: Partial<typeof q> = {}) => {
    const p = { ...q, ...over }, sp = new URLSearchParams(); Object.entries(p).forEach(([k, v]) => v && sp.set(k, v))
    const r = await fetch(`/api/revenue?${sp}`); const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErr(j.error ?? 'Could not load the revenue view'); return } setErr(''); setD(j); setQ({ from: j.range.from, to: j.range.to, currency: j.currency })
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  async function put(url: string, body: unknown, done: string) { setMsg(''); const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) { setErr(j.error ?? 'Failed'); return } setMsg(done); await load() }
  if (err && !d) return <p className="text-red-400">{err}</p>
  if (!d) return <p className="text-muted">Loading…</p>
  const Card = ({ label, value, note }: { label: string; value: string; note?: string }) => (<div className="bg-panel border border-line rounded-xl p-3"><div className="text-xs font-mono text-muted uppercase">{label}</div><div className="text-2xl font-semibold">{value}</div>{note && <div className="text-xs text-muted">{note}</div>}</div>)
  const rows = d.margins[dim] as any[]

  return (<div>
    <div className="flex flex-wrap justify-between items-end gap-3 mb-4"><div><h1 className="text-lg font-semibold">Revenue</h1><p className="text-sm text-muted">Calculated from contracts, invoices and payments — nothing here is typed in except the plan and the forecast weights.</p></div>
      <div className="flex gap-2 items-end text-xs"><label>From<br /><input type="month" className={inp} value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} /></label><label>To<br /><input type="month" className={inp} value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} /></label>
        <label>Currency<br /><select className={inp} value={q.currency} onChange={(e) => load({ currency: e.target.value })}>{[...new Set([q.currency, ...d.currencies])].map((c: string) => <option key={c}>{c}</option>)}</select></label>
        <button className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md text-sm" onClick={() => load()}>Show</button></div></div>
    {err && <div className="text-red-400 text-sm mb-2">{err}</div>}{msg && <div className="text-green-400 text-sm mb-2">{msg}</div>}
    {d.currencies.length > 1 && <p className="text-xs text-amber mb-3">You have deals in {d.currencies.length} currencies ({d.currencies.join(', ')}). They are never added together — choose one above.</p>}

    <div className="grid grid-cols-4 gap-3 mb-5"><Card label="Booked" value={`${money(d.totals.booked)} ${d.currency}`} note="contracts signed in this period" /><Card label="Invoiced" value={money(d.totals.invoiced)} note="invoices issued" /><Card label="Collected" value={money(d.totals.collected)} note="payments received" /><Card label="Outstanding now" value={money(d.outstanding)} note="invoiced and not yet paid, in total" /></div>

    <h2 className="text-xs font-mono text-muted uppercase mb-2">By month, against plan</h2>
    <div className="bg-panel border border-line rounded-xl overflow-auto mb-6"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th className="p-2">Month</th><th className="p-2 text-right">Booked</th><th className="p-2 text-right">Plan</th><th className="p-2 text-right">Variance</th><th className="p-2 text-right">Invoiced</th><th className="p-2 text-right">Collected</th>{d.can_plan && <th className="p-2"></th>}</tr></thead><tbody>
      {d.months.map((m: any) => (<tr key={m.month} className="border-t border-line"><td className="p-2 font-mono">{m.month}</td><td className="p-2 text-right font-mono">{money(m.booked)}</td><td className="p-2 text-right font-mono text-muted">{money(m.plan_booked)}</td>
        <td className={`p-2 text-right font-mono ${m.booked_variance == null ? 'text-muted' : m.booked_variance < 0 ? 'text-red-400' : 'text-green-400'}`}>{m.booked_variance == null ? '—' : `${m.booked_variance > 0 ? '+' : ''}${money(m.booked_variance)}${m.booked_pct != null ? ` (${m.booked_pct}%)` : ''}`}</td>
        <td className="p-2 text-right font-mono">{money(m.invoiced)}</td><td className="p-2 text-right font-mono">{money(m.collected)}</td>
        {d.can_plan && <td className="p-2 text-right"><button className="text-xs underline text-muted" onClick={() => { const v = window.prompt(`Booked target for ${m.month} in ${d.currency} (leave empty to clear)`, m.plan_booked ?? ''); if (v !== null) put('/api/revenue/plan', { period: m.month, currency: d.currency, booked_target: v.trim() === '' ? null : Number(v) }, 'Plan saved.') }}>set plan</button></td>}</tr>))}</tbody></table></div>

    <div className="flex justify-between items-end mb-2"><h2 className="text-xs font-mono text-muted uppercase">Margin by</h2><div className="flex gap-1">{Object.keys(DIM_LABEL).map((k) => <button key={k} onClick={() => setDim(k)} className={`px-2 py-1 rounded text-xs ${dim === k ? 'bg-amber text-black' : 'border border-line text-muted'}`}>{DIM_LABEL[k]}</button>)}</div></div>
    <div className="bg-panel border border-line rounded-xl overflow-auto mb-2"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th className="p-2">{DIM_LABEL[dim]}</th><th className="p-2 text-right">Deals</th><th className="p-2 text-right">Revenue</th><th className="p-2 text-right">Gross margin</th><th className="p-2 text-right">Net margin</th><th className="p-2 text-right">Cost unknown</th></tr></thead><tbody>
      {rows.length === 0 && <tr><td className="p-4 text-muted" colSpan={6}>No deals were signed in this period in {d.currency}.</td></tr>}
      {rows.map((r) => (<tr key={r.key} className="border-t border-line"><td className="p-2">{r.key}</td><td className="p-2 text-right font-mono">{r.deals}</td><td className="p-2 text-right font-mono">{money(r.revenue)}</td><td className="p-2 text-right font-mono">{r.gross_pct == null ? '—' : `${money(r.gross)} (${pct(r.gross_pct)})`}</td><td className="p-2 text-right font-mono">{r.net_pct == null ? '—' : `${money(r.net)} (${pct(r.net_pct)})`}</td><td className="p-2 text-right font-mono text-muted">{r.unknown_cost_revenue ? money(r.unknown_cost_revenue) : ''}</td></tr>))}</tbody></table></div>
    <p className="text-xs text-muted mb-6">Gross = revenue − what the vendor is paid. Net = gross − the agent&apos;s cut. Deals entered as already running have no cost on record: their revenue counts, but they are left out of the margin figures and shown under “cost unknown”.</p>
    {d.reconciliation.length > 0 && <div className="bg-panel border border-amber rounded-xl p-3 mb-6 text-sm"><div className="text-amber font-semibold mb-1">{d.reconciliation.length} contract(s) no longer equal the sum of their lines</div><p className="text-xs text-muted">Booked uses the contract value; margin uses the lines. {d.reconciliation.slice(0, 5).map((x: any) => `${x.brand ?? 'A deal'}: contract ${money(x.contract)}, lines ${money(x.lines)}`).join(' · ')}</p></div>}

    <h2 className="text-xs font-mono text-muted uppercase mb-2">Forecast from the open pipeline</h2>
    <div className="bg-panel border border-line rounded-xl overflow-auto mb-2"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th className="p-2">Stage</th><th className="p-2 text-right">Proposals</th><th className="p-2 text-right">Value</th><th className="p-2 text-right">Chance of winning</th><th className="p-2 text-right">Weighted</th></tr></thead><tbody>
      {d.forecast.stages.map((s: any) => (<tr key={s.stage} className="border-t border-line"><td className="p-2">{s.stage}</td><td className="p-2 text-right font-mono">{s.count}</td><td className="p-2 text-right font-mono">{money(s.value)}</td>
        <td className="p-2 text-right font-mono">{d.can_plan ? <button className="underline" onClick={() => { const v = window.prompt(`Chance of winning a proposal at "${s.stage}" (0–100)`, String(s.weight_pct)); if (v !== null && v.trim() !== '') put('/api/revenue/weights', { weights: { [s.stage]: Number(v) } }, 'Weights saved.') }}>{s.weight_pct}%</button> : `${s.weight_pct}%`}</td><td className="p-2 text-right font-mono">{money(s.weighted)}</td></tr>))}
      <tr className="border-t border-line font-semibold"><td className="p-2">Total</td><td className="p-2 text-right font-mono">{d.forecast.total.count}</td><td className="p-2 text-right font-mono">{money(d.forecast.total.value)}</td><td></td><td className="p-2 text-right font-mono">{money(d.forecast.total.weighted)}</td></tr></tbody></table></div>
    <p className="text-xs text-muted">{d.forecast.total.estimated > 0 ? `${d.forecast.total.estimated} proposal(s) have no priced lines yet and are valued at their budget. ` : ''}The weights are a starting point{d.can_plan ? ' — click one to change it' : '; the CEO can change them'}.</p>
  </div>)
}
