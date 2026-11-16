'use client'
import { useState } from 'react'
import { formatSummary } from '@/lib/chatParse'

/* eslint-disable @typescript-eslint/no-explicit-any */
const inp = 'bg-panel2 border border-line rounded-md px-2 py-1.5 text-sm'
const KINDS = ['request', 'approval', 'update', 'proof', 'other']

/** L30: paste a WhatsApp / Telegram export → PREVIEW (nothing is saved) → map who is who and what each message is → confirm. */
export default function ChatImport({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false); const [text, setText] = useState(''); const [order, setOrder] = useState<'dmy' | 'mdy'>('dmy'); const [channel, setChannel] = useState('whatsapp')
  const [pv, setPv] = useState<any>(null); const [us, setUs] = useState<Record<string, boolean>>({}); const [party, setParty] = useState<Record<string, string>>({}); const [kind, setKind] = useState<Record<number, string>>({}); const [skip, setSkip] = useState<Record<number, boolean>>({})
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false)

  async function preview() {
    setErr(''); setMsg(''); setBusy(true)
    const r = await fetch(`/api/projects/${projectId}/chat-import/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, date_order: order, utc_offset_minutes: -new Date().getTimezoneOffset() }) }); const j = await r.json(); setBusy(false)
    if (!r.ok) { setErr(j.error); return }
    if (j.count === 0) { setErr('That does not look like a WhatsApp or Telegram export — no messages were found.'); return }
    setPv(j); setUs({}); setParty({}); setKind(Object.fromEntries(j.messages.map((m: any) => [m.index, m.suggested_kind]))); setSkip(Object.fromEntries(j.messages.map((m: any) => [m.index, m.duplicate])))
  }
  const entries = () => (pv?.messages ?? []).filter((m: any) => !skip[m.index]).map((m: any) => ({
    occurred_at: m.occurred_at, direction: us[m.sender] ? 'outbound' : 'inbound', channel, kind: kind[m.index], party_id: party[m.sender] || undefined, summary: formatSummary(m.sender, m.text, !!party[m.sender]).summary }))
  async function confirm() {
    setBusy(true); setErr(''); const r = await fetch(`/api/projects/${projectId}/chat-import/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: entries() }) }); const j = await r.json(); setBusy(false)
    if (!r.ok) { setErr(j.error + (j.rejected ? ': ' + j.rejected.map((x: any) => `#${x.index + 1} ${x.error}`).join('; ') : '')); return }
    setMsg(`Imported ${j.imported} message${j.imported === 1 ? '' : 's'}${j.skipped_duplicates ? `, skipped ${j.skipped_duplicates} already in the log` : ''}.`); setPv(null); setText(''); onDone()
  }
  if (!open) return <button className="text-xs underline text-muted mb-3" onClick={() => setOpen(true)}>Import a pasted chat…</button>
  const n = entries().length
  return (<div className="bg-panel border border-line rounded-xl p-3 mb-4 text-sm">
    <div className="flex justify-between mb-2"><b>Import a chat</b><button className="text-xs underline text-muted" onClick={() => { setOpen(false); setPv(null) }}>Close</button></div>
    {msg && <div className="text-green-400 mb-2">{msg}</div>}{err && <div className="text-red-400 mb-2">{err}</div>}
    {!pv && (<>
      <p className="text-xs text-muted mb-2">Paste a WhatsApp “Export chat” or a Telegram Desktop copy. Nothing is saved until you have reviewed it on the next screen.</p>
      <textarea className={`${inp} w-full font-mono`} rows={8} placeholder={'[12/05/2026, 10:32:15] Name: message…'} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex gap-3 items-center mt-2"><label className="text-xs text-muted">Dates are <select className={inp} value={order} onChange={(e) => setOrder(e.target.value as 'dmy' | 'mdy')}><option value="dmy">day/month/year</option><option value="mdy">month/day/year</option></select></label>
        <label className="text-xs text-muted">Channel <select className={inp} value={channel} onChange={(e) => setChannel(e.target.value)}>{['whatsapp', 'telegram', 'email', 'other'].map((c) => <option key={c}>{c}</option>)}</select></label>
        <button disabled={busy || !text.trim()} onClick={preview} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md disabled:opacity-40">Preview</button></div></>)}
    {pv && (<>
      <p className="text-xs text-muted mb-2">{pv.count} messages found{pv.skipped_system ? ` · ${pv.skipped_system} system line(s) ignored` : ''}{pv.invalid_dates ? ` · ${pv.invalid_dates} with an impossible date skipped (check the date order)` : ''}{pv.truncated ? ' · only the first 500 are shown' : ''}. Tell me who is who:</p>
      <table className="w-full text-xs mb-3"><tbody>{pv.senders.map((s: any) => (<tr key={s.name} className="border-b border-line"><td className="p-1.5"><b>{s.name}</b> <span className="text-muted">({s.messages})</span></td>
        <td className="p-1.5"><label><input type="checkbox" checked={!!us[s.name]} onChange={(e) => setUs({ ...us, [s.name]: e.target.checked })} /> this is us (EmergeX)</label></td>
        <td className="p-1.5"><select className={inp} value={party[s.name] ?? ''} onChange={(e) => setParty({ ...party, [s.name]: e.target.value })}><option value="">No party</option>{pv.parties.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.role.replace(/_/g, ' ')})</option>)}</select></td></tr>))}</tbody></table>
      <div className="max-h-80 overflow-auto border border-line rounded mb-3"><table className="w-full text-xs"><tbody>{pv.messages.map((m: any) => (<tr key={m.index} className={`border-b border-line align-top ${skip[m.index] ? 'opacity-40' : ''}`}>
        <td className="p-1.5"><input type="checkbox" checked={!skip[m.index]} onChange={(e) => setSkip({ ...skip, [m.index]: !e.target.checked })} /></td>
        <td className="p-1.5 font-mono text-muted whitespace-nowrap">{new Date(m.occurred_at).toLocaleString()}</td><td className="p-1.5"><b>{m.sender}</b>: {m.text.length > 220 ? m.text.slice(0, 220) + '…' : m.text}{m.duplicate && <span className="text-amber"> (already in the log)</span>}{m.too_long && <span className="text-amber"> (will be cut at 2,000 characters)</span>}</td>
        <td className="p-1.5"><select className={inp} value={kind[m.index]} onChange={(e) => setKind({ ...kind, [m.index]: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></td></tr>))}</tbody></table></div>
      <p className="text-xs text-muted mb-2">“request” entries stay open until someone resolves them — mark only real open asks as requests. Imported entries can&apos;t be edited afterwards.</p>
      <div className="flex gap-3"><button disabled={busy || n === 0} onClick={confirm} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md disabled:opacity-40">Import {n} message{n === 1 ? '' : 's'}</button><button className="underline text-muted" onClick={() => setPv(null)}>Back</button></div></>)}
  </div>)
}
