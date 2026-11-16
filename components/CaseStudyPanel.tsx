'use client'
import { useEffect, useState } from 'react'

/* eslint-disable @typescript-eslint/no-explicit-any */
const inp = 'bg-panel2 border border-line rounded-md px-2 py-1.5 text-sm'

/** L23: the case study for a CLOSED project — drafted from the records, edited by the team, approved by Manager/CEO. */
export default function CaseStudyPanel({ projectId, closed, canManage, onChange }: { projectId: string; closed: boolean; canManage: boolean; onChange: () => void }) {
  const [data, setData] = useState<any>(null); const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [leaks, setLeaks] = useState<string[]>([])
  const [view, setView] = useState<'named' | 'anon'>('named'); const [named, setNamed] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const load = async () => { const r = await fetch(`/api/projects/${projectId}/case-study`); if (!r.ok) return; const j = await r.json(); setData(j); setLeaks(j.leaks ?? []); if (j.case_study) { setTitle(j.case_study.title); setBody(j.case_study.body) } }
  useEffect(() => { load() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  const cs = data?.case_study
  async function call(url: string, method: string, payload?: unknown, done?: string) {
    setErr(''); setMsg(''); const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined }); const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErr(j.error ?? 'Failed'); if (j.leaks) setLeaks(j.leaks); return null }
    if (done) setMsg(done); if (j.leaks) setLeaks(j.leaks); await load(); onChange(); return j
  }
  if (!data) return <p className="text-muted text-sm">Loading…</p>
  const dirty = cs && (title !== cs.title || body !== cs.body)

  return (<div>
    {err && <div className="text-red-400 text-sm mb-2">{err}</div>}{msg && <div className="text-green-400 text-sm mb-2">{msg}</div>}
    {!cs && (<div className="bg-panel border border-line rounded-xl p-4 text-sm">
      {closed ? <><p className="mb-2">No case study yet. The draft is generated from this project&apos;s deliverables, proof, metrics and delivery % — every figure is copied from the records, nothing is invented. You then edit it and a Manager or CEO approves it.</p>
        <button className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md" onClick={() => call(`/api/projects/${projectId}/case-study`, 'POST', {}, 'Draft created.')}>Draft the case study</button></>
        : <p className="text-muted">A case study is drafted from a finished project. Close the project first.</p>}</div>)}
    {cs && (<div>
      <div className="flex items-center gap-3 mb-3 text-sm"><span className={`px-2 py-0.5 rounded text-xs font-semibold ${cs.status === 'approved' ? 'bg-green-900 text-green-300' : 'bg-panel2 text-amber'}`}>{cs.status === 'approved' ? 'Approved' : 'Draft'}</span>
        {cs.status === 'approved' && <span className="text-muted">{cs.named_use_approved ? 'The brand agreed to being named.' : 'Anonymised only — the brand has not agreed to being named.'}</span>}
        <span className="text-xs text-muted">Tags: {cs.brand_name} · {cs.category_keys.join(', ') || '—'} · {cs.markets.join(', ') || '—'} · {cs.property_names.join(', ') || '—'}</span></div>
      <div className="flex gap-2 mb-2 text-sm"><button onClick={() => setView('named')} className={`px-2 py-1 rounded ${view === 'named' ? 'bg-amber text-black' : 'border border-line text-muted'}`}>Named (edit)</button><button onClick={() => setView('anon')} className={`px-2 py-1 rounded ${view === 'anon' ? 'bg-amber text-black' : 'border border-line text-muted'}`}>Anonymised preview</button></div>
      {leaks.length > 0 && <div className="bg-red-950 border border-red-800 text-red-300 text-sm rounded p-2 mb-2">The anonymised version still contains: <b>{leaks.join(', ')}</b>. Edit the text so it does not appear — it cannot be approved until then.</div>}
      {view === 'named' ? (<><input className={`${inp} w-full mb-2 font-semibold`} value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className={`${inp} w-full font-mono`} rows={20} value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex gap-3 mt-2 items-center"><button disabled={!dirty} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md text-sm disabled:opacity-40" onClick={() => call(`/api/projects/${projectId}/case-study`, 'PATCH', { title, body }, 'Saved.')}>Save edits</button>
          {cs.status === 'approved' && <span className="text-xs text-amber">Saving an edit takes it back to draft — it will need approving again.</span>}
          <button className="text-xs underline text-muted ml-auto" onClick={() => window.confirm('Draft again from the records? This overwrites your edits.') && call(`/api/projects/${projectId}/case-study`, 'POST', { confirm_overwrite: true }, 'Redrafted from the records.')}>Redraft from records…</button></div></>)
        : (<div className="bg-panel border border-line rounded-xl p-3"><div className="font-semibold mb-2">{cs.anonymised_title}</div><pre className="whitespace-pre-wrap text-sm font-sans">{cs.anonymised_body}</pre><p className="text-xs text-muted mt-2">Always generated from the named text — you can&apos;t type here. This is what appears in pitches.</p></div>)}
      {canManage && (<div className="mt-4 border-t border-line pt-3 text-sm">
        {cs.status === 'draft' ? (<><label className="flex gap-2 items-start mb-2"><input type="checkbox" checked={named} onChange={(e) => setNamed(e.target.checked)} className="mt-1" /><span>The brand has agreed to being named in pitches (leave unticked: anonymised only).</span></label>
          <button disabled={dirty || leaks.length > 0} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md disabled:opacity-40" onClick={() => call(`/api/projects/${projectId}/case-study/approve`, 'POST', { named_use_approved: named }, 'Approved — it is now in the repository.')}>Approve for the repository</button>{dirty && <span className="text-xs text-muted ml-2">Save your edits first.</span>}</>)
          : <button className="underline text-muted" onClick={() => call(`/api/projects/${projectId}/case-study/withdraw`, 'POST', undefined, 'Withdrawn from the repository.')}>Withdraw approval</button>}</div>)}
    </div>)}
  </div>)
}
