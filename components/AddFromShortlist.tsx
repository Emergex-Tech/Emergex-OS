'use client'
import { useEffect, useState } from 'react'

/** Adds every item on one of your shortlists to this proposal, one line each, using the SAME endpoint as adding a single item — so every pricing rule and gate still applies. Items that can't be added are listed with the reason. */
export default function AddFromShortlist({ proposalId, onDone }: { proposalId: string; onDone: () => void }) {
  const [lists, setLists] = useState<{ id: string; name: string; item_count: number; mine: boolean }[]>([]); const [id, setId] = useState('')
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [problems, setProblems] = useState<string[]>([])
  useEffect(() => { fetch('/api/shortlists').then((r) => (r.ok ? r.json() : [])).then(setLists) }, [])

  async function run() {
    setBusy(true); setMsg(''); setProblems([])
    const detail = await (await fetch(`/api/shortlists/${id}`)).json()
    let added = 0; const bad: string[] = []
    for (const it of detail.items ?? []) {
      const r = await fetch(`/api/proposals/${proposalId}/lines`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: it.item_id }) })
      if (r.ok) added++; else bad.push(`${it.items.name}: ${(await r.json()).error}`)
    }
    setMsg(`Added ${added} of ${(detail.items ?? []).length}.`); setProblems(bad); setBusy(false); onDone()
  }
  if (lists.length === 0) return null
  return (
    <div className="bg-panel border border-line rounded-xl p-4 mb-4">
      <div className="text-xs text-muted uppercase mb-2">Add from a shortlist</div>
      <div className="flex gap-2"><select value={id} onChange={(e) => setId(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm flex-1"><option value="">Choose a shortlist…</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.item_count}){l.mine ? '' : ' — shared'}</option>)}</select>
        <button onClick={run} disabled={busy || !id} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">{busy ? 'Adding…' : 'Add all'}</button></div>
      {msg && <div className="text-green-400 text-sm mt-2">{msg}</div>}{problems.map((p, i) => <div key={i} className="text-amber text-xs mt-1">{p}</div>)}
    </div>
  )
}
