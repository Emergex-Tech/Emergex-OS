'use client'
import { useEffect, useState } from 'react'
import ReportView from './ReportView'
import { CADENCES, CADENCE_LABEL, type Cadence } from '@/lib/reportCadence'

/* eslint-disable @typescript-eslint/no-explicit-any */
const inp = 'bg-panel2 border border-line rounded-md px-2 py-1.5 text-sm'

/** L16–L21 on the project page: what the brand sees, who sees it, and for how long. */
export default function ReportPanel({ projectId, deliverables, canManage, closed }: { projectId: string; deliverables: { id: string; description: string }[]; canManage: boolean; closed: boolean }) {
  const [pv, setPv] = useState<any>(null); const [links, setLinks] = useState<any>(null); const [snaps, setSnaps] = useState<any[]>([]); const [settings, setSettings] = useState<any>(null); const [routeAgent, setRouteAgent] = useState<any>(null)
  const [proofs, setProofs] = useState<Record<string, any[]>>({}); const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [fresh, setFresh] = useState<{ url: string } | null>(null)
  const [nl, setNl] = useState({ label: '', days: '30' }); const [log, setLog] = useState<{ id: string; rows: any[] } | null>(null); const [viewSnap, setViewSnap] = useState<any>(null)
  const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, init); const d = await r.json().catch(() => ({})); return { ok: r.ok, d } }
  const load = async () => {
    const [a, b, c, s] = await Promise.all([j(`/api/projects/${projectId}/report`), j(`/api/projects/${projectId}/report/links`), j(`/api/projects/${projectId}/report/snapshots`), j(`/api/projects/${projectId}/report/settings`)])
    if (a.ok) setPv(a.d); if (b.ok) setLinks(b.d); if (c.ok) setSnaps(c.d); if (s.ok) { setSettings(s.d.settings); setRouteAgent(s.d.route_agent) }
    const out: Record<string, any[]> = {}; for (const x of deliverables) { const p = await j(`/api/deliverables/${x.id}/proofs`); out[x.id] = p.ok ? p.d : [] } setProofs(out)
  }
  useEffect(() => { load() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  async function act(url: string, method: string, body?: unknown, done?: string) {
    setErr(''); setMsg(''); const r = await j(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!r.ok) { setErr(r.d.error ?? 'Failed'); return null } if (done) setMsg(done); await load(); return r.d
  }
  async function download(url: string, name: string) { const r = await fetch(url); if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? 'Download failed'); return } const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; a.click(); URL.revokeObjectURL(a.href) }
  if (!pv || !links || !settings) return <p className="text-muted text-sm">Loading…</p>
  const allProofs = deliverables.flatMap((d) => (proofs[d.id] ?? []).map((p) => ({ ...p, del: d })))

  return (<div className="space-y-6">
    {err && <div className="text-red-400 text-sm">{err}</div>}{msg && <div className="text-green-400 text-sm">{msg}</div>}
    {!pv.links_released && <div className="bg-panel border border-amber rounded-xl p-3 text-sm text-amber">External report links are <b>switched off</b>. They are released by an administrator (REPORT_LINKS_ENABLED) after the security review — until then you can preview, take snapshots and export PDFs, but cannot create a link.</div>}
    {!pv.safe_to_share && <div className="bg-red-950 border border-red-800 text-red-300 text-sm rounded-xl p-3">This report currently contains names that must stay internal: <b>{pv.leaks.join(', ')}</b> (a vendor or delivery-side agent). Edit the wording of the deliverable or proof it appears in — no link can be created, and an existing link shows nothing, until it is fixed.</div>}

    <section><h3 className="text-xs font-mono text-muted uppercase mb-2">Settings</h3>
      <div className="bg-panel border border-line rounded-xl p-3 flex flex-wrap gap-3 items-end text-sm">
        <label>Branding<br /><select disabled={!canManage} className={inp} value={settings.branding} onChange={(e) => act(`/api/projects/${projectId}/report/settings`, 'PUT', { branding: e.target.value }, 'Saved.')}><option value="emergex">EmergeX</option><option value="agent" disabled={!routeAgent}>{routeAgent ? `${routeAgent.agent_name} only` : 'Agent (this deal had no agent)'}</option><option value="co_branded" disabled={!routeAgent}>{routeAgent ? `EmergeX × ${routeAgent.agent_name}` : 'Co-branded (no agent)'}</option></select></label>
        <label>Snapshot cadence<br /><select disabled={!canManage} className={inp} value={settings.cadence} onChange={(e) => act(`/api/projects/${projectId}/report/settings`, 'PUT', { cadence: e.target.value }, 'Saved.')}>{CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c as Cadence]}</option>)}</select></label>
        <label className="flex-1 min-w-[200px]">Title shown to the brand<br /><input disabled={!canManage} className={`${inp} w-full`} defaultValue={settings.title ?? ''} placeholder="(the project name)" onBlur={(e) => e.target.value !== (settings.title ?? '') && act(`/api/projects/${projectId}/report/settings`, 'PUT', { title: e.target.value || null }, 'Saved.')} /></label>
        {!canManage && <span className="text-xs text-muted">Manager or CEO changes these.</span>}
      </div>
      <p className="text-xs text-muted mt-1">Branding shows the agent&apos;s <b>name only</b>. Snapshots are saved automatically once a day when due (and a final one when the project is closed).</p></section>

    <section><h3 className="text-xs font-mono text-muted uppercase mb-2">Proof the brand can see</h3>
      <p className="text-xs text-muted mb-2">Nothing is shown to the brand until you tick it. Untick to hide it again — it takes effect immediately.{closed ? ' This project is closed, so these choices are locked.' : ''}</p>
      <div className="bg-panel border border-line rounded-xl divide-y divide-line text-sm">{allProofs.length === 0 && <div className="p-3 text-muted">No proof on file yet.</div>}
        {allProofs.map((p) => (<label key={p.id} className="flex gap-3 items-center p-2.5"><input type="checkbox" disabled={closed} checked={!!p.report_visible} onChange={(e) => act(`/api/deliverables/${p.del.id}/proofs/${p.id}`, 'PATCH', { report_visible: e.target.checked })} /><span className="flex-1">{p.kind === 'link' ? '🔗' : '📎'} {p.name}<span className="text-muted"> — {p.del.description}</span></span></label>))}</div></section>

    <section><h3 className="text-xs font-mono text-muted uppercase mb-2">Links for the brand</h3>
      {canManage && (<div className="bg-panel border border-line rounded-xl p-3 mb-2 flex flex-wrap gap-2 items-end text-sm">
        <input className={`${inp} w-56`} placeholder="Who is it for? (e.g. Blitz marketing)" value={nl.label} onChange={(e) => setNl({ ...nl, label: e.target.value })} />
        <label className="text-xs text-muted">Expires in <input type="number" min="1" max="365" className={`${inp} w-20`} value={nl.days} onChange={(e) => setNl({ ...nl, days: e.target.value })} /> days</label>
        <button disabled={!pv.links_released || !pv.safe_to_share} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md disabled:opacity-40" onClick={async () => { const r = await act(`/api/projects/${projectId}/report/links`, 'POST', { label: nl.label || undefined, expires_in_days: Number(nl.days) }); if (r) setFresh({ url: r.url }) }}>Create link</button></div>)}
      {fresh && (<div className="bg-panel border border-amber rounded-xl p-3 mb-2 text-sm"><div className="text-amber font-semibold mb-1">Copy this link now — it cannot be shown again.</div><div className="flex gap-2"><input readOnly className={`${inp} flex-1 font-mono`} value={fresh.url} onFocus={(e) => e.target.select()} /><button className="underline" onClick={() => navigator.clipboard?.writeText(fresh.url)}>Copy</button><button className="underline text-muted" onClick={() => setFresh(null)}>Done</button></div></div>)}
      <div className="bg-panel border border-line rounded-xl divide-y divide-line text-sm">{links.links.length === 0 && <div className="p-3 text-muted">No links yet.</div>}
        {links.links.map((l: any) => (<div key={l.id} className="p-2.5"><div className="flex gap-3 items-center"><span className={`text-xs px-2 py-0.5 rounded ${l.state === 'active' ? 'bg-green-900 text-green-300' : 'bg-panel2 text-muted'}`}>{l.state}</span><span className="flex-1">{l.label ?? 'Report link'}<span className="text-muted"> · created {new Date(l.created_at).toLocaleDateString()} by {l.created_by_name} · expires {new Date(l.expires_at).toLocaleDateString()} · {l.views} view{l.views === 1 ? '' : 's'}{l.last_viewed_at ? `, last ${new Date(l.last_viewed_at).toLocaleString()}` : ''}</span></span>
          <button className="underline text-muted text-xs" onClick={async () => { if (log?.id === l.id) { setLog(null); return } const r = await j(`/api/projects/${projectId}/report/links/${l.id}/views`); if (r.ok) setLog({ id: l.id, rows: r.d }) }}>View log</button>
          {canManage && l.state === 'active' && <button className="underline text-red-400 text-xs" onClick={() => window.confirm('Revoke this link? It stops working immediately and cannot be undone.') && act(`/api/projects/${projectId}/report/links/${l.id}/revoke`, 'POST', undefined, 'Link revoked.')}>Revoke</button>}</div>
          {log && log.id === l.id && <div className="mt-2 text-xs text-muted max-h-48 overflow-auto">{log.rows.length === 0 ? 'Not viewed yet.' : log.rows.map((v) => <div key={v.id}>{new Date(v.viewed_at).toLocaleString()} — {v.kind}{v.user_agent ? ` · ${v.user_agent.slice(0, 60)}` : ''}</div>)}</div>}</div>))}</div></section>

    <section><h3 className="text-xs font-mono text-muted uppercase mb-2">Snapshots</h3>
      <div className="flex gap-3 mb-2 text-sm"><button className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md" onClick={() => act(`/api/projects/${projectId}/report/snapshots`, 'POST', {}, 'Snapshot saved.')}>Save a snapshot now</button><button className="underline text-muted" onClick={() => download(`/api/projects/${projectId}/report/pdf`, 'report.pdf')}>Download PDF of the current report</button></div>
      <div className="bg-panel border border-line rounded-xl divide-y divide-line text-sm">{snaps.length === 0 && <div className="p-3 text-muted">No snapshots yet.</div>}
        {snaps.map((s) => (<div key={s.id} className="p-2.5 flex gap-3 items-center"><span className="font-mono text-xs text-muted w-24">{s.period_date}</span><span className="flex-1">{s.trigger === 'closing' ? 'Final report (project closed)' : s.trigger === 'cadence' ? 'Automatic' : `Saved by ${s.taken_by_name ?? 'staff'}`}{s.blocked && <span className="text-red-400"> · held back: it contained an internal name, so it is never shown to the brand</span>}</span>
          <button className="underline text-muted text-xs" onClick={async () => { const r = await j(`/api/projects/${projectId}/report/snapshots/${s.id}`); if (r.ok) setViewSnap(r.d) }}>View</button><button className="underline text-muted text-xs" onClick={() => download(`/api/projects/${projectId}/report/pdf?snapshot=${s.id}`, `report-${s.period_date}.pdf`)}>PDF</button></div>))}</div></section>

    <section><div className="flex justify-between items-center mb-2"><h3 className="text-xs font-mono text-muted uppercase">{viewSnap ? `Snapshot of ${viewSnap.period_date}` : 'Preview — exactly what the brand sees'}</h3>{viewSnap && <button className="underline text-xs text-muted" onClick={() => setViewSnap(null)}>Back to the current report</button>}</div>
      <div className="border border-line rounded-xl p-5"><ReportView report={viewSnap ? viewSnap.content : pv.report} proofHref={() => '#'} /></div>
      <p className="text-xs text-muted mt-1">In this preview proof files are not loaded; the brand opens them through the link.</p></section>
  </div>)
}
