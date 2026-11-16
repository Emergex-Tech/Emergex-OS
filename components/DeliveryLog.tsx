'use client'
import { useEffect, useState } from 'react'
import { PLATFORM_LABEL, type Platform } from '@/lib/proofLinks'

/* eslint-disable @typescript-eslint/no-explicit-any */
const inp = 'bg-panel2 border border-line rounded-md px-2 py-1.5 text-sm'
const today = () => new Date().toISOString().slice(0, 10)

/**
 * The delivery log of one deliverable: each post, match or day, with its date and links. The delivered number is the SUM of this log
 * (the database keeps it so), which is why the number can't be typed once a log exists. Entries are voided, never edited.
 */
export default function DeliveryLog({ deliverable, closed, onChange }: { deliverable: { id: string; description: string; unit: string | null; status: string }; closed: boolean; onChange: () => void }) {
  const [data, setData] = useState<any>(null); const [f, setF] = useState({ occurred_on: today(), quantity: '1', label: '', links: '', brand: false }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const load = async () => { const r = await fetch(`/api/deliverables/${deliverable.id}/events`); if (r.ok) setData(await r.json()) }
  useEffect(() => { load() }, [deliverable.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const locked = closed || deliverable.status === 'replaced' || deliverable.status === 'waived'
  async function add() {
    setBusy(true); setErr('')
    const links = f.links.split(/\s+/).map((x) => x.trim()).filter(Boolean)
    const r = await fetch(`/api/deliverables/${deliverable.id}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ occurred_on: f.occurred_on, quantity: Number(f.quantity), label: f.label || undefined, links: links.length ? links : undefined, show_links_to_brand: f.brand }) })
    const j = await r.json().catch(() => ({})); setBusy(false)
    if (!r.ok) { setErr(j.error ?? 'Failed'); return }
    setF({ ...f, label: '', links: '' }); await load(); onChange()
  }
  async function voidIt(id: string) {
    const reason = window.prompt('Why is this entry wrong? (it is voided, not deleted)'); if (!reason) return
    const r = await fetch(`/api/deliverables/${deliverable.id}/events/${id}/void`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) })
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? 'Failed'); return } await load(); onChange()
  }
  if (!data) return <div className="text-xs text-muted p-2">Loading…</div>
  return (<div className="bg-panel2 border border-line rounded-lg p-3 text-xs">
    <div className="font-semibold mb-2">Delivery log — {deliverable.description}</div>
    {err && <div className="text-red-400 mb-2">{err}</div>}
    {data.events.length === 0 ? <div className="text-muted mb-2">Nothing logged yet. Log each post, match or day here and the delivered number follows.</div> : (
      <table className="w-full mb-2"><tbody>{data.events.map((e: any) => (<tr key={e.id} className="border-b border-line last:border-0 align-top">
        <td className="py-1 pr-3 font-mono text-muted whitespace-nowrap">{e.occurred_on}</td><td className="py-1 pr-3 font-mono whitespace-nowrap">{e.quantity}{deliverable.unit ? ` ${deliverable.unit}` : ''}</td>
        <td className="py-1 pr-3">{e.label ?? '—'}{e.links.length > 0 && <div className="mt-0.5 flex flex-wrap gap-x-3">{e.links.map((l: any) => <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" className="underline text-blue-400">{PLATFORM_LABEL[l.platform as Platform] ?? 'link'}{l.report_visible ? '' : ' (hidden from brand)'}</a>)}</div>}
          <div className="text-muted">{e.source === 'tracker_import' ? 'imported' : 'logged'} by {e.created_by_name ?? '—'}</div></td>
        <td className="py-1 text-right">{!closed && <button className="underline text-muted" onClick={() => voidIt(e.id)}>void</button>}</td></tr>))}</tbody></table>)}
    {locked ? <div className="text-muted">{closed ? 'This project is closed, so the log is locked.' : deliverable.status === 'waived' ? 'Waived by the brand — reinstate it to log a delivery.' : 'Replaced by a make-good — log against the make-good.'}</div> : (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center"><input type="date" className={inp} max={today()} value={f.occurred_on} onChange={(e) => setF({ ...f, occurred_on: e.target.value })} />
          <input type="number" min="0" step="any" className={`${inp} w-20`} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} title="Quantity" />
          <input className={`${inp} flex-1 min-w-[160px]`} placeholder="What was it? (e.g. vs Jaffna Kings, Diwali reel)" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
        <textarea className={`${inp} w-full font-mono`} rows={2} placeholder="Links, one per line — Instagram, Facebook, X, TikTok, YouTube or Google Drive (optional)" value={f.links} onChange={(e) => setF({ ...f, links: e.target.value })} />
        <div className="flex gap-3 items-center"><label className="flex gap-1 items-center text-muted"><input type="checkbox" checked={f.brand} onChange={(e) => setF({ ...f, brand: e.target.checked })} />show these links to the brand</label>
          <button disabled={busy || !f.occurred_on || !(Number(f.quantity) > 0)} onClick={add} className="bg-amber text-black font-semibold px-3 py-1 rounded-md disabled:opacity-40 ml-auto">Log it</button></div>
      </div>)}
  </div>)
}
