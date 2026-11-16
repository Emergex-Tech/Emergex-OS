'use client'
import { useState } from 'react'

/* eslint-disable @typescript-eslint/no-explicit-any */
const inp = 'bg-panel2 border border-line rounded-md px-2 py-1.5 text-sm'
const KINDS: [string, string][] = [['deliverables', 'a list of what was sold'], ['post_log', 'a log of posts / deliveries'], ['status_list', 'a done / not-done status list'], ['ad_campaign', 'an ad-campaign summary'], ['ad_daily', 'daily ad figures']]
const KIND_LABEL = Object.fromEntries(KINDS)
const today = () => new Date().toISOString().slice(0, 10)
const n = (v: number | null | undefined) => (v == null ? '—' : Math.round(v).toLocaleString())

/** Import an existing tracker (.xlsx): pick the file, pick a sheet, REVIEW what was understood, then confirm. Nothing is saved before the confirm. */
export default function TrackerImport({ projectId, canManage, onDone }: { projectId: string; canManage: boolean; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null); const [ov, setOv] = useState<any>(null); const [pv, setPv] = useState<any>(null); const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false)
  const [order, setOrder] = useState('dmy'); const [pick, setPick] = useState<Record<string, string>>({})
  const [list, setList] = useState<any[]>([]); const [times, setTimes] = useState<Record<string, string>>({ match: '1', year: '1', month: '1' })
  const [target, setTarget] = useState(''); const [fallback, setFallback] = useState(''); const [greenLabel, setGreenLabel] = useState(''); const [brand, setBrand] = useState(false)
  const [asOf, setAsOf] = useState(today()); const [brandQty, setBrandQty] = useState(''); const [vendorQty, setVendorQty] = useState(''); const [ack, setAck] = useState(false); const [st, setSt] = useState<any[]>([])

  async function post(fields: Record<string, string>, f = file) {
    if (!f) return null; setBusy(true); setErr(''); setMsg('')
    const fd = new FormData(); fd.append('file', f); Object.entries(fields).forEach(([k, v]) => fd.append(k, v))
    const r = await fetch(`/api/projects/${projectId}/tracker-import/preview`, { method: 'POST', body: fd }); const j = await r.json().catch(() => ({})); setBusy(false)
    if (!r.ok) { setErr(j.error ?? 'Could not read that file'); return null } return j
  }
  async function choose(f: File | null) { setFile(f); setOv(null); setPv(null); if (f) { const j = await post({}, f); if (j) { setOv(j); setPick(Object.fromEntries(j.sheets.map((s: any) => [s.name, s.looks_like ?? 'deliverables']))) } } }
  async function open(sheet: string, kind: string) {
    const j = await post({ sheet, kind, date_order: order }); if (!j) return
    setPv(j); setTarget(''); setAck(false)
    if (kind === 'deliverables') setList(j.result.rows.map((r: any) => ({ ...r })))
    if (kind === 'ad_campaign') { setBrandQty(j.result.brandGtd ? String(j.result.brandGtd) : ''); setVendorQty(String(j.result.vendorGtd ?? j.result.sheetGtd ?? '')); setAsOf(today()) }
    if (kind === 'status_list') setSt(j.result.rows.map((r: any) => ({ ...r, deliverable_id: r.match ?? '', action: r.match ? (r.suggestion === 'none' ? 'skip' : r.suggestion) : 'skip', reason: r.remark ?? '' })))
  }
  async function confirm(path: string, body: unknown, done: (j: any) => string) {
    setBusy(true); setErr(''); const r = await fetch(`/api/projects/${projectId}/tracker-import/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); setBusy(false)
    if (!r.ok) { setErr((j.error ?? 'Failed') + (j.rejected ? ': ' + j.rejected.slice(0, 6).map((x: any) => `row ${x.index + 1} ${x.error}`).join('; ') : '')); return }
    setMsg(done(j)); setPv(null); onDone()
  }
  // "24 per year" x 2 years => two deliverables (Year 1, Year 2); "6 per match" x 11 matches => one deliverable of 66
  const expanded = list.filter((r) => r.include).flatMap((r) => {
    const k = Math.max(1, Math.floor(Number(times[r.per ?? ''] ?? 1)) || 1)
    if (r.per === 'year' || r.per === 'month') return Array.from({ length: k }, (_, i) => ({ description: r.description, planned_quantity: Number(r.quantity), unit: r.unit ?? undefined, period_label: `${r.per === 'year' ? 'Year' : 'Month'} ${i + 1}` }))
    return [{ description: r.description, planned_quantity: Number(r.quantity) * (r.per === 'match' ? k : 1), unit: r.unit ?? undefined }]
  })
  const postRows = pv?.kind === 'post_log' ? pv.result.rows.filter((r: any) => r.links.length > 0 && (r.date || fallback)) : []
  const pers = Array.from(new Set(list.filter((r) => r.include && r.per).map((r) => r.per as string)))
  const openDels = (pv?.deliverables ?? []).filter((d: any) => d.status !== 'replaced' && d.status !== 'waived')
  const DelSelect = ({ value, onChange, all }: { value: string; onChange: (v: string) => void; all?: boolean }) => (<select className={inp} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Choose a deliverable…</option>{(all ? pv.deliverables : openDels).map((d: any) => <option key={d.id} value={d.id}>{d.description}{d.period_label ? ` (${d.period_label})` : ''} — {n(d.delivered_quantity)}/{n(d.planned_quantity)}</option>)}</select>)
  const Head = ({ what }: { what: string }) => (<div className="flex justify-between mb-2"><b>“{pv.sheet}” — {what}</b><button className="underline text-xs text-muted" onClick={() => setPv(null)}>Back to the sheets</button></div>)
  const Checks = ({ items }: { items: string[] }) => items.length === 0 ? null : (<div className="bg-red-950 border border-red-800 rounded-xl p-3 mb-3 text-xs"><div className="text-red-300 font-semibold mb-1">This sheet disagrees with itself — check before importing:</div><ul className="list-disc ml-5 text-red-300">{items.map((c, i) => <li key={i}>{c}</li>)}</ul>
    <label className="flex gap-2 items-center mt-2 text-red-200"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I have checked these and want to import the figures as they are.</label></div>)
  const stRows = st.filter((r) => r.action !== 'skip' && r.deliverable_id)

  return (<div className="text-sm">
    <p className="text-xs text-muted mb-3">Bring in a tracker you already keep (Excel .xlsx — for a Google Sheet use File → Download → Excel). You review everything before it is saved, and importing an updated version of the same tracker later only adds what is new.</p>
    {err && <div className="text-red-400 mb-2">{err}</div>}{msg && <div className="text-green-400 mb-2">{msg}</div>}
    <div className="flex gap-3 items-center mb-3"><input type="file" accept=".xlsx" className="text-xs" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
      <label className="text-xs text-muted">Typed dates are <select className={inp} value={order} onChange={(e) => setOrder(e.target.value)}><option value="dmy">day/month/year</option><option value="mdy">month/day/year</option></select></label>{busy && <span className="text-muted">Working…</span>}</div>

    {ov && !pv && (<div className="bg-panel border border-line rounded-xl divide-y divide-line mb-3">{ov.sheets.map((s: any) => (<div key={s.name} className="p-2.5 flex gap-3 items-center"><span className="flex-1"><b>{s.name}</b> <span className="text-muted">· {s.rows} rows{s.looks_like ? ` · looks like ${KIND_LABEL[s.looks_like]}` : ' · not recognised'}</span></span>
      <select className={`${inp} text-xs`} value={pick[s.name] ?? 'deliverables'} onChange={(e) => setPick({ ...pick, [s.name]: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>Read as {l}</option>)}</select>
      <button className="bg-amber text-black font-semibold px-3 py-1 rounded-md text-xs" onClick={() => open(s.name, pick[s.name] ?? 'deliverables')}>Read</button></div>))}</div>)}

    {pv?.kind === 'deliverables' && (<div><Head what={`${list.length} rows read`} />
      {!pv.has_contract && <div className="text-amber mb-2">This project has no contract yet, so there is nowhere to put deliverables. Create the contract first.</div>}
      {pers.map((p) => <label key={p} className="block text-xs text-amber mb-1">Some rows are “per {p}”. How many {p === 'match' ? 'matches' : p + 's'}? <input type="number" min="1" className={`${inp} w-20`} value={times[p]} onChange={(e) => setTimes({ ...times, [p]: e.target.value })} />{p !== 'match' ? ` — one deliverable is created per ${p}` : ' — the quantity is multiplied'}</label>)}
      <div className="bg-panel border border-line rounded-xl overflow-auto max-h-96 mb-2"><table className="w-full text-xs"><tbody>{list.map((r, i) => (<tr key={i} className={`border-b border-line align-top ${r.include ? '' : 'opacity-50'}`}>
        <td className="p-2"><input type="checkbox" checked={r.include} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} /></td>
        <td className="p-2"><input className={`${inp} w-full`} value={r.description} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} /><div className="text-muted">{r.details && `sheet says: “${r.details}”`}{r.remarks && ` · ${r.remarks}`}</div>{r.hint && <div className="text-amber">{r.hint}</div>}</td>
        <td className="p-2 whitespace-nowrap"><input type="number" min="0" step="any" className={`${inp} w-20`} value={r.quantity} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />{r.per ? ` per ${r.per}` : ''}</td></tr>))}</tbody></table></div>
      <button disabled={busy || !canManage || !pv.has_contract || expanded.length === 0} onClick={() => confirm('deliverables', { deliverables: expanded }, (j) => `Created ${j.created} deliverable${j.created === 1 ? '' : 's'}${j.skipped_existing ? `, ${j.skipped_existing} already existed` : ''}.`)} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md disabled:opacity-40">Create {expanded.length} deliverable{expanded.length === 1 ? '' : 's'}</button>{!canManage && <span className="text-xs text-muted ml-2">A Manager or CEO creates deliverables.</span>}
    </div>)}

    {pv?.kind === 'post_log' && (<div><Head what={`${pv.result.rows.length} rows with something in them`} />
      <div className="text-xs text-muted mb-2">{pv.result.skipped} blank or junk rows ignored{pv.result.rejectedLinks ? ` · ${pv.result.rejectedLinks} link(s) not accepted (not Instagram, Facebook, X, TikTok, YouTube or Drive)` : ''}{pv.result.highlighted ? ` · ${pv.result.highlighted} highlighted in green` : ''}</div>
      {pv.result.legends.map((l: string, i: number) => <div key={i} className="text-xs text-amber mb-1">The sheet says: “{l}”</div>)}
      <div className="flex flex-wrap gap-3 items-end mb-2"><label className="text-xs">These count towards<br /><DelSelect value={target} onChange={setTarget} /></label>
        {pv.result.undated > 0 && <label className="text-xs text-amber">{pv.result.undated} row(s) have no date. Use this date for them<br /><input type="date" className={inp} max={today()} value={fallback} onChange={(e) => setFallback(e.target.value)} /></label>}
        {pv.result.highlighted > 0 && <label className="text-xs">Label for the green rows<br /><input className={inp} placeholder="e.g. Collab accepted by brand" value={greenLabel} onChange={(e) => setGreenLabel(e.target.value)} /></label>}
        <label className="text-xs flex gap-1 items-center"><input type="checkbox" checked={brand} onChange={(e) => setBrand(e.target.checked)} />show these links to the brand</label></div>
      {pv.deliverables.length === 0 && <div className="text-amber mb-2">This project has no deliverables yet — import or add the deliverables list first.</div>}
      <div className="bg-panel border border-line rounded-xl overflow-auto max-h-80 mb-2"><table className="w-full text-xs"><tbody>{pv.result.rows.map((r: any) => (<tr key={r.row} className={`border-b border-line ${r.links.length === 0 || (!r.date && !fallback) ? 'opacity-40' : ''}`}><td className="p-2 text-muted">row {r.row}</td><td className="p-2 font-mono">{r.date ?? (fallback || 'no date')}</td><td className="p-2">{[r.label, r.highlighted && greenLabel].filter(Boolean).join(' — ') || '—'}</td><td className="p-2">{r.links.map((l: any) => l.platform).join(', ') || '—'}</td><td className="p-2 text-amber">{r.problems.join('; ')}</td></tr>))}</tbody></table></div>
      <button disabled={busy || !target || postRows.length === 0} onClick={() => confirm('post-log', { deliverable_id: target, show_links_to_brand: brand, entries: postRows.map((r: any) => ({ occurred_on: r.date ?? fallback, label: [r.label, r.highlighted && greenLabel].filter(Boolean).join(' — ') || undefined, links: r.links.map((l: any) => l.url) })) }, (j) => `Imported ${j.imported} entr${j.imported === 1 ? 'y' : 'ies'} with ${j.links} link${j.links === 1 ? '' : 's'}${j.skipped_duplicates ? `; ${j.skipped_duplicates} were already there` : ''}. Delivered: ${j.deliverable.delivered_quantity} of ${j.deliverable.planned_quantity}.`)} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md disabled:opacity-40">Import {postRows.length} entr{postRows.length === 1 ? 'y' : 'ies'}</button>
    </div>)}

    {(pv?.kind === 'ad_campaign' || pv?.kind === 'ad_daily') && (() => { const r = pv.result, daily = pv.kind === 'ad_daily'
      const readings = daily ? r.readings : r.segments.map((s: any) => ({ recorded_on: asOf, segment: s.segment, impressions: s.impressions, clicks: s.clicks ?? 0 }))
      const needAck = r.checks.length > 0 && !ack
      return (<div><Head what={daily ? `${r.rowsRead} daily rows, ${r.firstDay} to ${r.lastDay}` : `${r.segments.length} region / ad-type figures`} />
        <Checks items={r.checks} />
        <div className="bg-panel border border-line rounded-xl overflow-auto mb-3"><table className="w-full text-xs"><thead><tr className="text-muted text-left"><th className="p-2">Region · ad type</th><th className="p-2 text-right">Impressions served</th><th className="p-2 text-right">Clicks</th><th className="p-2 text-right">CTR</th></tr></thead><tbody>
          {r.segments.map((s: any) => (<tr key={s.segment} className="border-t border-line"><td className="p-2">{s.segment}</td><td className="p-2 text-right font-mono">{n(s.impressions)}</td><td className="p-2 text-right font-mono">{n(s.clicks)}</td><td className="p-2 text-right font-mono">{s.impressions > 0 && s.clicks != null ? `${Math.round((s.clicks / s.impressions) * 10000) / 100}%` : '—'}</td></tr>))}
          <tr className="border-t border-line font-semibold"><td className="p-2">Total</td><td className="p-2 text-right font-mono">{n(r.totals.impressions)}</td><td className="p-2 text-right font-mono">{n(r.totals.clicks)}</td><td className="p-2 text-right font-mono">{r.totals.impressions > 0 ? `${Math.round((r.totals.clicks / r.totals.impressions) * 10000) / 100}%` : '—'}</td></tr></tbody></table></div>
        {daily && <p className="text-xs text-muted mb-2">Daily figures are added up into running totals, keeping one reading per week ({r.readings.length} readings) so the trend is kept.</p>}
        <div className="flex flex-wrap gap-3 items-end mb-2"><label className="text-xs">The deliverable holding the guaranteed impressions<br /><DelSelect value={target} onChange={setTarget} /></label>
          {!daily && <label className="text-xs">These figures are as of<br /><input type="date" className={inp} max={today()} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>}
          {!daily && canManage && <><label className="text-xs">Guaranteed to the BRAND<br /><input type="number" min="0" className={`${inp} w-36`} value={brandQty} placeholder="leave as it is" onChange={(e) => setBrandQty(e.target.value)} /></label><label className="text-xs" title="Internal only — never shown to the brand">Guaranteed to US by the publisher<br /><input type="number" min="0" className={`${inp} w-36`} value={vendorQty} placeholder="leave as it is" onChange={(e) => setVendorQty(e.target.value)} /></label></>}</div>
        {!daily && r.sheetGtd != null && <p className="text-xs text-amber mb-2">This sheet shows one guarantee ({n(r.sheetGtd)}) without saying whose it is. On an internal report it is usually the publisher&apos;s — so it is pre-filled there, and the brand&apos;s is left for you to enter.</p>}
        <button disabled={busy || !target || readings.length === 0 || needAck} onClick={() => confirm('campaign', { deliverable_id: target, readings, brand_quantity: !daily && canManage && brandQty ? Number(brandQty) : undefined, vendor_quantity: !daily && canManage && vendorQty ? Number(vendorQty) : undefined, acknowledge_implausible: ack || undefined }, (j) => `Recorded ${j.readings_added} reading${j.readings_added === 1 ? '' : 's'}. Served ${n(j.served)} of ${n(j.deliverable.planned_quantity)} · ${n(j.clicks)} clicks · CTR ${j.ctr_pct ?? '—'}%.`)} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md disabled:opacity-40">Import these figures</button>{needAck && <span className="text-xs text-muted ml-2">Tick the box above first.</span>}
      </div>) })()}

    {pv?.kind === 'status_list' && (<div><Head what={`${st.length} rows`} />
      {pv.result.unmatched > 0 && <div className="text-xs text-amber mb-2">{pv.result.unmatched} row(s) did not match anything on this project&apos;s contract — choose a deliverable for them or leave them skipped.</div>}
      <div className="flex flex-wrap gap-3 items-end mb-2"><label className="text-xs">“Completed” means done by<br /><input type="date" className={inp} max={today()} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label><label className="text-xs flex gap-1 items-center"><input type="checkbox" checked={brand} onChange={(e) => setBrand(e.target.checked)} />show these links to the brand</label></div>
      <div className="bg-panel border border-line rounded-xl overflow-auto max-h-96 mb-2"><table className="w-full text-xs"><tbody>{st.map((r, i) => { const up = (patch: any) => setSt(st.map((x, j) => (j === i ? { ...x, ...patch } : x))); return (<tr key={r.row} className={`border-b border-line align-top ${r.action === 'skip' ? 'opacity-50' : ''}`}>
        <td className="p-2"><b>{r.name}</b><div className="text-muted">{r.section ? `${r.section} · ` : ''}sheet says: {r.status === 'completed' ? 'completed' : r.status === 'not_completed' ? 'not completed' : 'unclear'}{r.remark ? ` — “${r.remark}”` : ''}</div>{r.links.length > 0 && <div className="text-muted">{r.links.length} link(s): {r.links.map((l: any) => l.platform).join(', ')}</div>}{r.rejected.length > 0 && <div className="text-amber">a link was not accepted: {r.rejected[0].slice(0, 60)}</div>}</td>
        <td className="p-2"><DelSelect all value={r.deliverable_id} onChange={(v) => up({ deliverable_id: v })} /></td>
        <td className="p-2"><select className={inp} value={r.action} onChange={(e) => up({ action: e.target.value })}><option value="skip">Leave as it is</option><option value="complete">Mark completed</option><option value="links" disabled={r.links.length === 0}>Only attach the link(s)</option><option value="waive" disabled={!canManage}>Waived by the brand{canManage ? '' : ' (Manager)'}</option></select>
          {r.action === 'waive' && <input className={`${inp} w-full mt-1`} placeholder="Why did the brand waive it?" value={r.reason} onChange={(e) => up({ reason: e.target.value })} />}</td></tr>) })}</tbody></table></div>
      <button disabled={busy || !asOf || stRows.length === 0} onClick={() => confirm('status-list', { as_of: asOf, show_links_to_brand: brand, rows: stRows.map((r) => ({ deliverable_id: r.deliverable_id, action: r.action, links: r.links.map((l: any) => l.url), reason: r.action === 'waive' ? r.reason : undefined })) }, (j) => `Marked ${j.completed} completed${j.already_complete ? ` (${j.already_complete} already were)` : ''}, ${j.waived} waived, ${j.links} link${j.links === 1 ? '' : 's'} attached.`)} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md disabled:opacity-40">Apply to {stRows.length} deliverable{stRows.length === 1 ? '' : 's'}</button>
    </div>)}
  </div>)
}
