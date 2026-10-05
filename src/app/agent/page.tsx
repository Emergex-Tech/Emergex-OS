'use client'
import { useEffect, useState } from 'react'

interface Item { id: string; title: string; category: string | null; market: string | null; event_start: string | null; event_end: string | null; offer_expiry: string | null; availability: string; details: Record<string, string | number | boolean>; indicative_price: { amount: number; currency: string } | null }
interface Note { id: string; note: string; submitted_at: string; status: string; claimed_price: { amount: number; currency: string } | null }

export default function AgentHome() {
  const [tab, setTab] = useState<'inventory' | 'intel'>('inventory')
  const [items, setItems] = useState<Item[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [open, setOpen] = useState<Item | null>(null)
  const [note, setNote] = useState(''); const [grantId, setGrantId] = useState(''); const [price, setPrice] = useState(''); const [currency, setCurrency] = useState('USD')
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false)

  async function loadItems() { const r = await fetch('/api/agent/items'); setItems(r.ok ? await r.json() : []) }
  async function loadNotes() { const r = await fetch('/api/agent/intel'); setNotes(r.ok ? await r.json() : []) }
  useEffect(() => { loadItems() }, [])
  useEffect(() => { if (tab === 'intel') loadNotes() }, [tab])

  async function view(i: Item) { const r = await fetch(`/api/agent/items/${i.id}`); if (r.ok) setOpen(await r.json()); else setMsg('That item is no longer shared with you.') }

  async function submit() {
    setBusy(true); setMsg('')
    try {
      const res = await fetch('/api/agent/intel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note, grant_id: grantId || undefined, price: price || undefined, currency }) })
      const data = await res.json(); if (!res.ok) throw new Error(data.error)
      setNote(''); setPrice(''); setGrantId(''); setMsg('Thanks — your note has been sent for review.'); loadNotes()
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : null)
  return (
    <div>
      <div className="flex gap-2 mb-5">
        {(['inventory', 'intel'] as const).map((t) => <button key={t} onClick={() => { setTab(t); setOpen(null) }} className={`px-3 py-1.5 rounded text-sm ${tab === t ? 'bg-amber text-black font-semibold' : 'border border-line text-muted'}`}>{t === 'inventory' ? 'Shared inventory' : 'Market intel'}</button>)}
      </div>
      {msg && <div className="text-amber text-sm mb-4">{msg}</div>}

      {tab === 'inventory' && !open && (
        <div className="grid grid-cols-2 gap-4">
          {items.map((i) => (
            <div key={i.id} className="bg-panel border border-line rounded-xl p-4">
              <div className="font-semibold mb-1">{i.title}</div>
              <div className="text-xs text-muted mb-2">{[i.category, i.market].filter(Boolean).join(' · ')}</div>
              <div className="text-sm mb-2">{i.availability === 'Available' ? <span className="text-green-400">Available</span> : <span className="text-muted">Not currently available</span>}</div>
              {i.indicative_price && <div className="font-mono text-amber text-sm mb-2">From {i.indicative_price.currency} {i.indicative_price.amount.toLocaleString()}</div>}
              <button onClick={() => view(i)} className="text-xs underline text-muted">View details</button>
            </div>
          ))}
          {items.length === 0 && <div className="col-span-2 bg-panel border border-line rounded-xl p-8 text-center text-muted">Nothing has been shared with you yet.</div>}
        </div>
      )}
      {tab === 'inventory' && open && (
        <div className="bg-panel border border-line rounded-xl p-6">
          <button onClick={() => setOpen(null)} className="text-xs underline text-muted mb-3">← Back</button>
          <h1 className="text-lg font-semibold mb-1">{open.title}</h1>
          <div className="text-sm text-muted mb-4">{[open.category, open.market].filter(Boolean).join(' · ')}</div>
          <table className="text-sm"><tbody>
            {open.event_start && <tr><td className="pr-6 py-1 text-muted">Event</td><td>{fmt(open.event_start)}{open.event_end ? ` – ${fmt(open.event_end)}` : ''}</td></tr>}
            {open.offer_expiry && <tr><td className="pr-6 py-1 text-muted">Offer valid until</td><td>{fmt(open.offer_expiry)}</td></tr>}
            <tr><td className="pr-6 py-1 text-muted">Availability</td><td>{open.availability}</td></tr>
            {open.indicative_price && <tr><td className="pr-6 py-1 text-muted">Indicative price</td><td className="font-mono">{open.indicative_price.currency} {open.indicative_price.amount.toLocaleString()}</td></tr>}
            {Object.entries(open.details).map(([k, v]) => <tr key={k}><td className="pr-6 py-1 text-muted capitalize">{k.replace(/_/g, ' ')}</td><td>{String(v)}</td></tr>)}
          </tbody></table>
        </div>
      )}

      {tab === 'intel' && (
        <div>
          <div className="bg-panel border border-line rounded-xl p-4 mb-5">
            <div className="text-xs text-muted uppercase mb-2">Share something you&apos;ve heard</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="What have you seen or heard in the market?" className="bg-panel2 border border-line rounded-md p-3 text-sm w-full h-24 mb-2" />
            <div className="flex gap-2 mb-2">
              <select value={grantId} onChange={(e) => setGrantId(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm flex-1"><option value="">Not about a specific item</option>{items.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}</select>
              <input type="number" min="0" placeholder="Price you heard (optional)" value={price} onChange={(e) => setPrice(e.target.value)} disabled={!grantId} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-52 disabled:opacity-40" />
              <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} disabled={!grantId} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-20 disabled:opacity-40" />
            </div>
            <button onClick={submit} disabled={busy || !note.trim()} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">Send for review</button>
          </div>
          <div className="bg-panel border border-line rounded-xl overflow-hidden"><table className="w-full text-sm"><tbody>
            {notes.map((n) => (<tr key={n.id} className="border-b border-line last:border-0"><td className="p-3 font-mono text-xs text-muted w-28">{fmt(n.submitted_at)}</td><td className="p-3">{n.note}{n.claimed_price && <span className="text-muted"> · {n.claimed_price.currency} {n.claimed_price.amount.toLocaleString()}</span>}</td><td className="p-3 text-xs text-right">{n.status}</td></tr>))}
            {notes.length === 0 && <tr><td className="p-6 text-center text-muted">You haven&apos;t sent any notes yet.</td></tr>}
          </tbody></table></div>
        </div>
      )}
    </div>
  )
}
