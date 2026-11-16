'use client'
import { useState } from 'react'
import Link from 'next/link'

/* eslint-disable @typescript-eslint/no-explicit-any */
const inp = 'bg-panel2 border border-line rounded-md px-2 py-1.5 text-sm'

/** L22: close / reopen a project. Closing shows EXACTLY what is still open, and needs a tick and a reason if anything is. */
export default function ClosureControls({ projectId, project, renewal, canManage, onChange }: { projectId: string; project: any; renewal: { id: string; stage: string } | null; canManage: boolean; onChange: (msg?: string) => void }) {
  const [open, setOpen] = useState(false); const [issues, setIssues] = useState<any[]>([]); const [ack, setAck] = useState(false); const [note, setNote] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const closed = project.status === 'closed'

  async function review() { setErr(''); setAck(false); setNote(''); const r = await fetch(`/api/projects/${projectId}/closure`); const j = await r.json(); if (!r.ok) { setErr(j.error); return } setIssues(j.issues); setOpen(true) }
  async function close() {
    setBusy(true); setErr(''); const r = await fetch(`/api/projects/${projectId}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acknowledge: ack, note }) }); const j = await r.json(); setBusy(false)
    if (!r.ok) { setErr(j.error); if (j.issues) setIssues(j.issues); return }
    setOpen(false); onChange('Project closed. Its delivery record is now locked and a renewal proposal has been drafted.')
  }
  async function reopen() {
    const reason = window.prompt('Why are you reopening this project? (it unlocks the delivery record)'); if (!reason) return
    const r = await fetch(`/api/projects/${projectId}/reopen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }); const j = await r.json()
    if (!r.ok) { setErr(j.error); return } onChange('Project reopened.')
  }

  return (<div className="mb-3">
    {closed && (<div className="bg-panel border border-line rounded-xl p-3 text-sm">
      <div className="flex justify-between items-start gap-4"><div><b className="text-amber">Closed</b> {project.closed_at ? new Date(project.closed_at).toLocaleDateString() : ''}{project.closed_by_name ? ` by ${project.closed_by_name}` : ''} — the delivery record is locked (the communication log stays open).
        {project.closure_note && <div className="text-muted">Reason on record: “{project.closure_note}”</div>}
        {Array.isArray(project.closure_warnings) && project.closure_warnings.length > 0 && <div className="text-xs text-muted mt-1">Open when it was closed: {project.closure_warnings.map((w: any) => w.code.replace(/_/g, ' ')).join(', ')}</div>}
        {renewal && <div className="mt-1">Renewal proposal: <Link href={`/proposals/${renewal.id}`} className="underline text-blue-400">open the draft ({renewal.stage})</Link></div>}</div>
        {canManage && <button className="text-xs underline text-muted whitespace-nowrap" onClick={reopen}>Reopen…</button>}</div></div>)}
    {!closed && canManage && !open && <button className="text-xs underline text-muted" onClick={review}>Close this project…</button>}
    {!closed && open && (<div className="bg-panel border border-line rounded-xl p-3 text-sm">
      <div className="font-semibold mb-1">Close this project?</div>
      <p className="text-xs text-muted mb-2">Closing locks the delivery record (checklist, deliverables, proof, metrics, parties) and drafts a renewal proposal. You can reopen it later.</p>
      {issues.length === 0 ? <p className="text-green-400 mb-2">Nothing is open — it is ready to close.</p> : (<>
        <p className="text-amber mb-1">Still open:</p><ul className="list-disc ml-5 mb-2">{issues.map((i) => <li key={i.code}>{i.detail}</li>)}</ul>
        <label className="flex gap-2 items-start mb-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" /><span>I understand, and want to close it anyway.</span></label></>)}
      <input className={`${inp} w-full mb-2`} placeholder={issues.length ? 'Why is it OK to close with these open? (required)' : 'Closing note (optional)'} value={note} onChange={(e) => setNote(e.target.value)} />
      {err && <div className="text-red-400 mb-2">{err}</div>}
      <div className="flex gap-3"><button disabled={busy || (issues.length > 0 && (!ack || note.trim().length < 5))} onClick={close} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md disabled:opacity-40">Close project</button><button className="underline text-muted" onClick={() => setOpen(false)}>Cancel</button></div></div>)}
    {err && !open && <div className="text-red-400 text-sm mt-1">{err}</div>}
  </div>)
}
