'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = 'checklist' | 'deliverables' | 'parties' | 'log' | 'upsells'
const STATUS_STYLE: Record<string, string> = { planned: 'text-muted', partial: 'text-amber', delivered: 'text-green-400', missed: 'text-red-400', replaced: 'text-muted line-through' }

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const [d, setD] = useState<any>(null); const [tab, setTab] = useState<Tab>('checklist'); const [role, setRole] = useState<string | null>(null)
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]); const [all, setAll] = useState<{ id: string; name: string }[]>([])
  const [comms, setComms] = useState<any>(null); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const [cf, setCf] = useState({ direction: 'outbound', channel: 'whatsapp', kind: 'request', party_id: '', summary: '' })
  const [pf, setPf] = useState({ role: 'vendor', name: '', contact: '' }); const [custom, setCustom] = useState({ phase_no: '1', side: 'team', title: '' }); const [qty, setQty] = useState<Record<string, string>>({})

  const load = async () => { const r = await fetch(`/api/projects/${id}`); if (r.ok) setD(await r.json()); else setError((await r.json()).error) }
  const loadComms = async () => { const r = await fetch(`/api/projects/${id}/communications`); if (r.ok) setComms(await r.json()) }
  useEffect(() => {
    load(); loadComms(); const sb = supabaseBrowser()
    sb.from('profiles').select('id, full_name').neq('role_key', 'agent').order('full_name').then(({ data }) => setStaff((data as any) ?? []))
    sb.from('projects').select('id, name').order('name').then(({ data }) => setAll((data as any) ?? []))
    sb.auth.getSession().then(async ({ data }) => { if (data.session) { const { data: p } = await sb.from('profiles').select('role_key').eq('id', data.session.user.id).single(); setRole(p?.role_key ?? null) } })
  }, [id])
  const canManage = ['manager', 'ceo', 'management'].includes(role ?? '')

  async function act(url: string, method: string, body?: unknown, done?: string) {
    setError(''); setNotice('')
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const data = await r.json().catch(() => ({})); if (!r.ok) { setError(data.error ?? 'Failed'); return null }
    if (done) setNotice(done); await load(); await loadComms(); return data
  }
  const item = (i: any, patch: unknown) => act(`/api/projects/${id}/checklist/${i.id}`, 'PATCH', patch)
  if (!d) return <div className="text-muted">{error || 'Loading…'}</div>
  const p = d.project, sum = d.deliverables.summary
  const inp = 'bg-panel2 border border-line rounded-md px-2 py-1.5 text-sm'
  const pct = (n: number | null) => (n == null ? '—' : `${n}%`)

  const ItemRow = ({ i }: { i: any }) => (
    <div className={`flex items-start gap-2 py-1.5 border-b border-line last:border-0 ${i.effective_status === 'na' ? 'opacity-50' : ''}`}>
      <input type="checkbox" className="mt-1" checked={i.effective_status === 'done'} disabled={i.effective_status === 'na' || (i.auto_satisfied && i.status !== 'done')} onChange={(e) => item(i, { status: e.target.checked ? 'done' : 'open' })} title={i.auto_satisfied ? 'Ticked automatically from the contract/invoice records' : ''} />
      <div className="flex-1 min-w-0 text-sm">
        <span className={i.effective_status === 'done' ? 'line-through text-muted' : ''}>{i.title}</span>
        {i.auto && <span className="ml-2 text-[10px] text-blue-400 uppercase">{i.auto_satisfied ? 'auto ✓' : 'auto'}</span>}
        {i.is_custom && <span className="ml-2 text-[10px] text-amber uppercase">custom</span>}
        {i.overdue && <span className="ml-2 text-[10px] text-red-400 uppercase">overdue</span>}
        {i.effective_status === 'na' && <div className="text-xs text-muted">N/A — {i.na_reason}</div>}
        <div className="flex gap-2 mt-1 flex-wrap">
          <select className={`${inp} text-xs`} value={i.owner_id ?? ''} onChange={(e) => item(i, { owner_id: e.target.value || null })}><option value="">No owner</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select>
          <input type="date" className={`${inp} text-xs`} defaultValue={i.due_date ?? ''} onBlur={(e) => { if ((e.target.value || null) !== i.due_date) item(i, { due_date: e.target.value || null }) }} />
          <input className={`${inp} text-xs flex-1 min-w-[120px]`} placeholder="Notes" defaultValue={i.notes ?? ''} onBlur={(e) => { if ((e.target.value || null) !== i.notes) item(i, { notes: e.target.value || null }) }} />
          {i.effective_status !== 'na' ? <button className="text-xs underline text-muted" onClick={() => { const why = window.prompt('Why does this step not apply?'); if (why) item(i, { status: 'na', na_reason: why }) }}>N/A</button> : <button className="text-xs underline text-muted" onClick={() => item(i, { status: 'open' })}>Reinstate</button>}
          {i.is_custom && <button className="text-xs underline text-red-400" onClick={() => act(`/api/projects/${id}/checklist/${i.id}`, 'DELETE')}>Remove</button>}
        </div>
      </div>
    </div>
  )

  return (
    <div>
      <div className="flex justify-between items-start mb-1">
        <div><h1 className="text-lg font-semibold">{p.name}</h1><div className="text-sm text-muted">{p.brand_name} · {p.template_name} template · owner <b className="text-white">{p.owner_name ?? '—'}</b>{p.parent && <> · upsell of <Link href={`/projects/${p.parent.id}`} className="underline text-blue-400">{p.parent.name}</Link></>}</div></div>
        {canManage && <div className="flex gap-2"><button className="text-xs underline text-muted" onClick={() => { const n = window.prompt('Project name:', p.name); if (n && n !== p.name) act(`/api/projects/${id}`, 'PATCH', { name: n }) }}>Rename</button>
          <select className={`${inp} text-xs`} value={p.owner_id ?? ''} onChange={(e) => e.target.value && act(`/api/projects/${id}`, 'PATCH', { owner_id: e.target.value }, 'Owner changed.')}><option value="">Change owner…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>}
      </div>
      <div className="grid grid-cols-4 gap-3 my-4">
        {[['Paperwork gate', d.checklist.gate.overall === 'cleared' ? 'Cleared' : 'Open', d.checklist.gate.overall === 'cleared' ? 'text-green-400' : 'text-amber', `brand ${d.checklist.gate.brand} · team ${d.checklist.gate.team}`],
          ['Checklist', pct(d.checklist.overall_pct), '', 'steps done, N/A excluded'], ['Delivery', pct(sum.pct), '', `${sum.counted} deliverable${sum.counted === 1 ? '' : 's'} · ${sum.missed} missed`],
          ['Open requests', `${d.requests.total}`, d.requests.onUs > 0 ? 'text-red-400' : '', `${d.requests.onUs} waiting on us · ${d.requests.onThem} on them`]].map(([l, v, c, s]) => (
          <div key={l} className="bg-panel border border-line rounded-xl p-3"><div className="text-xs font-mono text-muted uppercase">{l}</div><div className={`text-xl font-semibold ${c}`}>{v}</div><div className="text-xs text-muted">{s}</div></div>))}
      </div>
      {error && <div className="text-red-400 text-sm mb-2">{error}</div>}{notice && <div className="text-green-400 text-sm mb-2">{notice}</div>}
      <div className="flex gap-2 mb-4">{(['checklist', 'deliverables', 'parties', 'log', 'upsells'] as Tab[]).map((t) => <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded text-sm capitalize ${tab === t ? 'bg-amber text-black font-semibold' : 'border border-line text-muted'}`}>{t === 'log' ? 'Communication log' : t}</button>)}</div>

      {tab === 'checklist' && (<div>
        {d.checklist.phases.map((ph: any) => (
          <div key={ph.phase_no} className="bg-panel border border-line rounded-xl mb-3 overflow-hidden">
            <div className="px-3 py-2 border-b border-line flex justify-between"><span className="text-xs font-mono text-muted uppercase">{String(ph.phase_no).padStart(2, '0')} {ph.phase_name}</span><span className="text-xs">{ph.pct}% <span className="text-muted">· brand {ph.brand.done}/{ph.brand.total - ph.brand.na} · team {ph.team.done}/{ph.team.total - ph.team.na}</span></span></div>
            <div className="grid grid-cols-2 gap-x-4 px-3">
              {(['brand', 'team'] as const).map((side) => (<div key={side}><div className={`text-[10px] uppercase font-mono pt-2 ${side === 'brand' ? 'text-blue-400' : 'text-green-400'}`}>{side} side</div>{ph.items.filter((i: any) => i.side === side).map((i: any) => <ItemRow key={i.id} i={i} />)}</div>))}
            </div>
          </div>))}
        <div className="flex gap-2 items-center"><span className="text-xs text-muted">Add a step to this project:</span>
          <select className={inp} value={custom.phase_no} onChange={(e) => setCustom({ ...custom, phase_no: e.target.value })}>{d.checklist.phases.map((ph: any) => <option key={ph.phase_no} value={ph.phase_no}>{ph.phase_no}. {ph.phase_name}</option>)}</select>
          <select className={inp} value={custom.side} onChange={(e) => setCustom({ ...custom, side: e.target.value })}><option value="team">team</option><option value="brand">brand</option></select>
          <input className={`${inp} flex-1`} placeholder="Step" value={custom.title} onChange={(e) => setCustom({ ...custom, title: e.target.value })} />
          <button disabled={!custom.title.trim()} onClick={async () => { if (await act(`/api/projects/${id}/checklist`, 'POST', { ...custom, phase_no: Number(custom.phase_no) })) setCustom({ ...custom, title: '' }) }} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md text-sm disabled:opacity-40">Add</button></div>
      </div>)}

      {tab === 'deliverables' && (<div>
        {!d.contract_id ? <div className="bg-panel border border-line rounded-xl p-6 text-center text-muted">Deliverables come from the contract. <Link href="/contracts" className="underline text-blue-400">Create the contract</Link> first.</div> : (<>
          <div className="flex justify-between items-center mb-2"><span className="text-sm text-muted">Delivery {pct(sum.pct)} — every deliverable counts equally; a replaced one is left out (its make-good counts instead).</span>{canManage && <Link href={`/contracts/${d.contract_id}`} className="text-xs underline text-muted">Add or edit on the contract</Link>}</div>
          <div className="bg-panel border border-line rounded-xl overflow-hidden"><table className="w-full text-sm">
            <thead className="text-xs text-muted uppercase"><tr className="border-b border-line"><th className="text-left p-3">Deliverable</th><th className="text-left p-3">Due</th><th className="text-right p-3">Delivered / planned</th><th className="text-right p-3">%</th><th className="text-left p-3">Status</th><th className="p-3"></th></tr></thead>
            <tbody>{d.deliverables.items.map((x: any) => (
              <tr key={x.id} className="border-b border-line last:border-0 align-top">
                <td className="p-3">{x.description}{x.make_good_of && <span className="ml-2 text-[10px] text-amber uppercase">make-good</span>}{x.invoice_adjustment && <div className="text-xs text-amber">Invoice adjustment: {x.adjustment_note}</div>}</td>
                <td className="p-3 font-mono text-xs">{x.due_date ?? '—'}</td>
                <td className="p-3 text-right font-mono">{x.delivered_quantity} / {x.planned_quantity} <span className="text-muted text-xs">{x.unit}</span></td><td className="p-3 text-right font-mono">{x.pct}%</td>
                <td className={`p-3 text-xs ${STATUS_STYLE[x.status]}`}>{x.status}</td>
                <td className="p-3 text-xs text-right whitespace-nowrap">
                  {x.status !== 'replaced' && <><input type="number" min="0" className={`${inp} w-20 text-xs`} placeholder="delivered" value={qty[x.id] ?? ''} onChange={(e) => setQty({ ...qty, [x.id]: e.target.value })} /> <button className="underline text-muted mr-2" disabled={(qty[x.id] ?? '') === ''} onClick={async () => { if (await act(`/api/deliverables/${x.id}`, 'PATCH', { delivered_quantity: Number(qty[x.id]) }, 'Recorded.')) setQty({ ...qty, [x.id]: '' }) }}>Record</button></>}
                  {canManage && (x.status === 'planned' || x.status === 'partial') && <button className="underline text-red-400 mr-2" onClick={() => window.confirm('Mark this deliverable as missed?') && act(`/api/deliverables/${x.id}`, 'PATCH', { status: 'missed' })}>Missed</button>}
                  {canManage && x.status === 'missed' && !x.invoice_adjustment && <><button className="underline text-muted mr-2" onClick={() => act(`/api/deliverables/${x.id}/make-good`, 'POST', {}, 'Make-good created.')}>Make-good</button><button className="underline text-muted" onClick={() => { const n = window.prompt('What should the invoice adjustment be?'); if (n) act(`/api/deliverables/${x.id}/invoice-adjustment`, 'POST', { flag: true, note: n }, 'Flagged for finance.') }}>Flag invoice adjustment</button></>}
                  {canManage && x.status === 'missed' && x.invoice_adjustment && <button className="underline text-muted" onClick={() => act(`/api/deliverables/${x.id}/invoice-adjustment`, 'POST', { flag: false })}>Clear flag</button>}
                </td></tr>))}
              {d.deliverables.items.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted">No deliverables on the contract yet.</td></tr>}</tbody></table></div></>)}
      </div>)}

      {tab === 'parties' && (<div>
        <div className="bg-panel border border-line rounded-xl overflow-hidden mb-4"><table className="w-full text-sm"><tbody>
          {d.parties.map((x: any) => (<tr key={x.id} className="border-b border-line last:border-0"><td className="p-3 text-xs w-32"><span className={x.side === 'brand' ? 'text-blue-400' : x.side === 'delivery' ? 'text-green-400' : 'text-amber'}>{x.role.replace('_', ' ')}</span></td><td className="p-3">{x.name}{x.contact && <div className="text-xs text-muted">{x.contact}</div>}</td><td className="p-3 text-right text-xs"><button className="underline text-muted" onClick={() => act(`/api/projects/${id}/parties/${x.id}`, 'DELETE')}>Remove</button></td></tr>))}</tbody></table></div>
        <div className="flex gap-2"><select className={inp} value={pf.role} onChange={(e) => setPf({ ...pf, role: e.target.value })}>{['vendor', 'talent', 'delivery_agent', 'brand_route', 'other'].map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</select>
          <input className={`${inp} flex-1`} placeholder="Name" value={pf.name} onChange={(e) => setPf({ ...pf, name: e.target.value })} /><input className={`${inp} flex-1`} placeholder="Contact (optional)" value={pf.contact} onChange={(e) => setPf({ ...pf, contact: e.target.value })} />
          <button disabled={!pf.name.trim()} onClick={async () => { if (await act(`/api/projects/${id}/parties`, 'POST', { role: pf.role, name: pf.name, contact: pf.contact || undefined, side: pf.role === 'other' ? 'delivery' : undefined })) setPf({ ...pf, name: '', contact: '' }) }} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md text-sm disabled:opacity-40">Add party</button></div>
      </div>)}

      {tab === 'log' && comms && (<div>
        <p className="text-sm mb-3">{comms.requests.total === 0 ? 'No open requests.' : <><b className={comms.requests.onUs ? 'text-red-400' : ''}>{comms.requests.onUs} waiting on us</b> · {comms.requests.onThem} waiting on them{comms.requests.oldestDays != null && <span className="text-muted"> · oldest {comms.requests.oldestDays} day{comms.requests.oldestDays === 1 ? '' : 's'}</span>}</>}</p>
        <div className="bg-panel border border-line rounded-xl p-3 mb-4">
          <div className="flex gap-2 mb-2 flex-wrap">
            <select className={inp} value={cf.direction} onChange={(e) => setCf({ ...cf, direction: e.target.value })}><option value="outbound">We sent</option><option value="inbound">We received</option></select>
            <select className={inp} value={cf.kind} onChange={(e) => setCf({ ...cf, kind: e.target.value })}>{['request', 'approval', 'update', 'proof', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}</select>
            <select className={inp} value={cf.channel} onChange={(e) => setCf({ ...cf, channel: e.target.value })}>{['whatsapp', 'telegram', 'email', 'call', 'meeting', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}</select>
            <select className={inp} value={cf.party_id} onChange={(e) => setCf({ ...cf, party_id: e.target.value })}><option value="">No party</option>{d.parties.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div className="flex gap-2"><input className={`${inp} flex-1`} placeholder={cf.kind === 'request' ? 'What was asked of whom?' : 'What happened?'} value={cf.summary} onChange={(e) => setCf({ ...cf, summary: e.target.value })} />
            <button disabled={!cf.summary.trim()} onClick={async () => { if (await act(`/api/projects/${id}/communications`, 'POST', { ...cf, party_id: cf.party_id || undefined }, 'Logged.')) setCf({ ...cf, summary: '' }) }} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md text-sm disabled:opacity-40">Log</button></div>
          <p className="text-xs text-muted mt-2">Entries can&apos;t be edited or deleted — only an open request can be resolved. Record a correction as a new entry.</p></div>
        <div className="bg-panel border border-line rounded-xl overflow-hidden"><table className="w-full text-sm"><tbody>
          {comms.entries.map((e: any) => (<tr key={e.id} className="border-b border-line last:border-0 align-top"><td className="p-3 text-xs font-mono text-muted w-28">{new Date(e.occurred_at).toLocaleDateString()}<div>{e.direction === 'outbound' ? '→ sent' : '← received'}</div></td>
            <td className="p-3">{e.summary}<div className="text-xs text-muted">{e.kind} · {e.channel}{e.party_name ? ` · ${e.party_name}` : ''} · {e.created_by_name}</div>{e.resolution_note && <div className="text-xs text-green-400">Resolved: {e.resolution_note}</div>}</td>
            <td className="p-3 text-right text-xs">{e.status === 'open' ? <><span className={e.waiting_on === 'us' ? 'text-red-400' : 'text-amber'}>waiting on {e.waiting_on}</span><br /><button className="underline text-muted" onClick={() => act(`/api/projects/${id}/communications/${e.id}/resolve`, 'POST', { note: window.prompt('How was it resolved? (optional)') ?? undefined })}>Resolve</button></> : e.kind === 'request' ? <span className="text-green-400">resolved</span> : null}</td></tr>))}
          {comms.entries.length === 0 && <tr><td className="p-6 text-center text-muted">Nothing logged yet.</td></tr>}</tbody></table></div>
      </div>)}

      {tab === 'upsells' && (<div>
        {d.upsells.length === 0 ? <p className="text-sm text-muted mb-4">No upsells linked to this project.</p> : <>
          <p className="text-sm mb-2">Combined delivery with upsells: <b>{pct(d.combined_delivery?.pct ?? null)}</b></p>
          <div className="bg-panel border border-line rounded-xl overflow-hidden mb-4"><table className="w-full text-sm"><tbody>{d.upsells.map((u: any) => (<tr key={u.id} className="border-b border-line last:border-0"><td className="p-3"><Link href={`/projects/${u.id}`} className="underline text-blue-400">{u.name}</Link></td><td className="p-3 text-right font-mono">{pct(u.delivery.pct)}</td>{canManage && <td className="p-3 text-right text-xs"><button className="underline text-muted" onClick={() => act(`/api/projects/${u.id}/parent`, 'POST', { parent_project_id: null }, 'Unlinked.')}>Unlink</button></td>}</tr>))}</tbody></table></div></>}
        {canManage && !p.parent && <div className="flex gap-2 items-center"><span className="text-xs text-muted">Make THIS project an upsell of:</span>
          <select className={inp} defaultValue="" onChange={(e) => e.target.value && window.confirm('Link this project as an upsell of the selected one?') && act(`/api/projects/${id}/parent`, 'POST', { parent_project_id: e.target.value }, 'Linked.')}><option value="">Choose the original project…</option>{all.filter((x) => x.id !== id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>}
        {canManage && p.parent && <button className="text-xs underline text-muted" onClick={() => act(`/api/projects/${id}/parent`, 'POST', { parent_project_id: null }, 'Unlinked.')}>Unlink from {p.parent.name}</button>}
      </div>)}
    </div>
  )
}
