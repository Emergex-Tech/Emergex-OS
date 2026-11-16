'use client'
import { useEffect, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

interface ScoreChange {
  id: string
  field: 'strength' | 'reliability'
  old_value: number | null
  new_value: number
  created_at: string
  routes: { market: string | null; route_type: string; brands: { name: string } | null } | null
}
interface Override {
  id: string
  entity_type: string
  entity_name: string
  period_days: number
  reason: string
  direction: string
  created_at: string
}

interface ShareOverride {
  id: string; conflict_types: string[]; conflicts: { detail: string }[]; reason: string; created_at: string
  items: { name: string } | null; brands: { name: string } | null; requester: { full_name: string | null } | null
}

export default function Approvals() {
  const [role, setRole] = useState<string | null>(null)
  const [scoreChanges, setScoreChanges] = useState<ScoreChange[]>([])
  const [overrides, setOverrides] = useState<Override[]>([])
  const [shareOverrides, setShareOverrides] = useState<ShareOverride[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const supabase = supabaseBrowser()
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      const { data: profile } = await supabase.from('profiles').select('role_key').eq('id', session.user.id).single()
      setRole(profile?.role_key ?? null)
    }

    const [sc, ov, so] = await Promise.all([
      fetch('/api/route-score-changes?status=pending').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/overrides?status=pending').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/share-overrides?status=pending').then((r) => (r.ok ? r.json() : []))
    ])
    setScoreChanges(sc)
    setOverrides(ov)
    setShareOverrides(so)
    setLoading(false)
  }

  async function actOnScoreChange(id: string, action: 'approve' | 'reject') {
    setBusyId(id)
    const res = await fetch(`/api/route-score-changes/${id}/${action}`, { method: 'PATCH' })
    if (!res.ok) { const d = await res.json(); alert(d.error) }
    setBusyId(null)
    load()
  }

  async function actOnOverride(id: string, action: 'approve' | 'reject') {
    let reason: string | null = null
    if (action === 'reject') {
      reason = window.prompt('Reason for rejecting this override? (optional)')
      if (reason === null) return // user cancelled
    }
    setBusyId(id)
    const res = await fetch(`/api/overrides/${id}/${action}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    })
    if (!res.ok) { const d = await res.json(); alert(d.error) }
    setBusyId(null)
    load()
  }

  async function actOnShareOverride(id: string, action: 'approve' | 'reject') {
    setBusyId(id)
    const res = await fetch(`/api/share-overrides/${id}/${action}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    if (!res.ok) { const d = await res.json(); alert(d.error) }
    setBusyId(null)
    load()
  }

  if (loading) return <div className="text-muted">Loading…</div>

  return (
    <div>
      <h1 className="text-lg font-semibold mb-1">Approvals</h1>
      <p className="text-muted text-sm mb-5">
        Everything here is enforced server-side regardless of this page — Team can view this queue, but only
        Management's approve/reject calls will actually succeed (the API checks the role, not this UI).
      </p>
      {role === 'team' && (
        <div className="bg-[#1f1810] border border-[#4a3a1e] text-amber rounded-md p-3 text-sm mb-6">
          You're signed in as Team. You can see what's pending, but approve/reject buttons below will be rejected by
          the server — this queue is Management's.
        </div>
      )}

      <h2 className="text-sm font-semibold text-muted uppercase mb-2">Route score changes ({scoreChanges.length})</h2>
      <div className="bg-panel border border-line rounded-xl overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted uppercase">
            <tr className="border-b border-line">
              <th className="text-left p-3">Brand</th><th className="text-left p-3">Route</th><th className="text-left p-3">Field</th>
              <th className="text-left p-3">Change</th><th className="text-left p-3">Requested</th><th className="text-left p-3"></th>
            </tr>
          </thead>
          <tbody>
            {scoreChanges.map((s) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className="p-3">{s.routes?.brands?.name ?? '—'}</td>
                <td className="p-3">{s.routes?.route_type.replace(/_/g, ' ')} · {s.routes?.market ?? '—'}</td>
                <td className="p-3 capitalize">{s.field}</td>
                <td className="p-3 font-mono">{s.old_value ?? '—'} → {s.new_value}</td>
                <td className="p-3 font-mono text-xs">{new Date(s.created_at).toLocaleDateString()}</td>
                <td className="p-3">
                  <div className="flex gap-2">
                    <button onClick={() => actOnScoreChange(s.id, 'approve')} disabled={busyId === s.id} className="bg-amber text-black font-semibold px-3 py-1 rounded text-xs disabled:opacity-40">Approve</button>
                    <button onClick={() => actOnScoreChange(s.id, 'reject')} disabled={busyId === s.id} className="border border-line px-3 py-1 rounded text-xs disabled:opacity-40">Reject</button>
                  </div>
                </td>
              </tr>
            ))}
            {scoreChanges.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted">Nothing pending.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="text-sm font-semibold text-muted uppercase mb-2">Lengthening overrides ({overrides.length})</h2>
      <div className="bg-panel border border-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted uppercase">
            <tr className="border-b border-line">
              <th className="text-left p-3">Record</th><th className="text-left p-3">Type</th><th className="text-left p-3">New period</th>
              <th className="text-left p-3">Reason</th><th className="text-left p-3">Requested</th><th className="text-left p-3"></th>
            </tr>
          </thead>
          <tbody>
            {overrides.map((o) => (
              <tr key={o.id} className="border-b border-line last:border-0">
                <td className="p-3">{o.entity_name}</td>
                <td className="p-3 capitalize">{o.entity_type}</td>
                <td className="p-3 font-mono">{o.period_days} days</td>
                <td className="p-3">{o.reason}</td>
                <td className="p-3 font-mono text-xs">{new Date(o.created_at).toLocaleDateString()}</td>
                <td className="p-3">
                  <div className="flex gap-2">
                    <button onClick={() => actOnOverride(o.id, 'approve')} disabled={busyId === o.id} className="bg-amber text-black font-semibold px-3 py-1 rounded text-xs disabled:opacity-40">Approve</button>
                    <button onClick={() => actOnOverride(o.id, 'reject')} disabled={busyId === o.id} className="border border-line px-3 py-1 rounded text-xs disabled:opacity-40">Reject</button>
                  </div>
                </td>
              </tr>
            ))}
            {overrides.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted">Nothing pending.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="text-sm font-semibold text-muted uppercase mb-2 mt-8">Share-conflict overrides ({shareOverrides.length})</h2>
      <div className="bg-panel border border-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted uppercase">
            <tr className="border-b border-line">
              <th className="text-left p-3">Brand</th><th className="text-left p-3">Item</th><th className="text-left p-3">Conflict</th>
              <th className="text-left p-3">Reason given</th><th className="text-left p-3">Requested by</th><th className="text-left p-3"></th>
            </tr>
          </thead>
          <tbody>
            {shareOverrides.map((o) => (
              <tr key={o.id} className="border-b border-line last:border-0 align-top">
                <td className="p-3">{o.brands?.name}</td>
                <td className="p-3">{o.items?.name}</td>
                <td className="p-3 text-xs">{(o.conflicts ?? []).map((c, i) => <div key={i}>• {c.detail}</div>)}</td>
                <td className="p-3">{o.reason}</td>
                <td className="p-3 text-xs text-muted">{o.requester?.full_name ?? '—'}<div className="font-mono">{new Date(o.created_at).toLocaleDateString()}</div></td>
                <td className="p-3">
                  <div className="flex gap-2">
                    <button onClick={() => actOnShareOverride(o.id, 'approve')} disabled={busyId === o.id} className="bg-amber text-black font-semibold px-3 py-1 rounded text-xs disabled:opacity-40">Approve</button>
                    <button onClick={() => actOnShareOverride(o.id, 'reject')} disabled={busyId === o.id} className="border border-line px-3 py-1 rounded text-xs disabled:opacity-40">Reject</button>
                  </div>
                </td>
              </tr>
            ))}
            {shareOverrides.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted">Nothing pending.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
