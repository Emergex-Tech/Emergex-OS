'use client'
import { useEffect, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

interface Note {
  id: string
  note: string
  source: string | null
  reliability: string
  linked_type: string | null
  created_at: string
}

export default function Intel() {
  const [notes, setNotes] = useState<Note[]>([])
  const [note, setNote] = useState('')
  const [reliability, setReliability] = useState('likely')
  const [linkedType, setLinkedType] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabaseBrowser()
      .from('intel_notes')
      .select('id, note, source, reliability, linked_type, created_at')
      .order('created_at', { ascending: false })
      .limit(50)
    setNotes(data ?? [])
  }

  async function submit() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/intel-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, reliability, linked_type: linkedType || null })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setNote('')
      setLinkedType('')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold mb-1">Intel</h1>
      <p className="text-muted text-sm mb-5">
        Notes link to any brand, agent, vendor, property, item or market. Agent-submitted notes stay invisible to
        other agents once agent logins exist (Stage 2B) — enforced by the intel_notes RLS policy, not by this page.
      </p>

      <div className="bg-panel border border-line rounded-xl p-4 mb-6">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What did you hear, and from where?"
          className="bg-panel2 border border-line rounded-md p-3 text-sm w-full h-20 resize-none mb-3"
        />
        <div className="flex gap-2">
          <select value={reliability} onChange={(e) => setReliability(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm">
            <option value="confirmed">Confirmed</option>
            <option value="likely">Likely</option>
            <option value="rumour">Rumour</option>
          </select>
          <select value={linkedType} onChange={(e) => setLinkedType(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm">
            <option value="">Not linked to a specific record</option>
            <option value="brand">Brand</option>
            <option value="brand_group">Brand group</option>
            <option value="agent">Agent</option>
            <option value="vendor">Vendor</option>
            <option value="property">Property</option>
            <option value="item">Item</option>
            <option value="market">Market</option>
          </select>
          <button onClick={submit} disabled={saving || !note.trim()} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">
            {saving ? 'Saving…' : 'Add note'}
          </button>
        </div>
        {error && <div className="text-red-400 text-sm mt-2">{error}</div>}
      </div>

      <div className="bg-panel border border-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted uppercase">
            <tr className="border-b border-line">
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Source</th>
              <th className="text-left p-3">Reliability</th>
              <th className="text-left p-3">Linked</th>
              <th className="text-left p-3">Note</th>
            </tr>
          </thead>
          <tbody>
            {notes.map((n) => (
              <tr key={n.id} className="border-b border-line last:border-0">
                <td className="p-3 font-mono text-xs">{new Date(n.created_at).toLocaleDateString()}</td>
                <td className="p-3 capitalize">{n.source}</td>
                <td className="p-3 capitalize">{n.reliability}</td>
                <td className="p-3 capitalize">{n.linked_type ?? '—'}</td>
                <td className="p-3">{n.note}</td>
              </tr>
            ))}
            {notes.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-muted">No notes yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
