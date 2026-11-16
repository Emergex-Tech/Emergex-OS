'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Contract { id: string; renewal_date: string | null; status: string; final_amount: number; currency: string; brand_name: string }
interface NeedsContract { deal_id: string; brand_name: string }

export default function Contracts() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [needing, setNeeding] = useState<NeedsContract[]>([])
  const [showNew, setShowNew] = useState(false)
  const [dealId, setDealId] = useState('')
  const [terms, setTerms] = useState('')
  const [renewalDate, setRenewalDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [role, setRole] = useState<string | null>(null)

  useEffect(() => { load() }, [])
  const canManage = role === 'manager' || role === 'ceo' || role === 'management'

  async function load() {
    const supabase = (await import('@/lib/supabaseBrowser')).supabaseBrowser()
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      const { data: profile } = await supabase.from('profiles').select('role_key').eq('id', session.user.id).single()
      setRole(profile?.role_key ?? null)
    }
    const [c, n] = await Promise.all([
      fetch('/api/contracts').then((r) => (r.ok ? r.json() : [])),
      // GET here isn't permission-gated (everyone benefits from seeing what needs a contract) —
      // only the POST that actually creates one is. The "+ New contract" button is hidden for Team
      // client-side so it doesn't offer an action the server will 403 on.
      fetch('/api/deals/needing-contract').then((r) => (r.ok ? r.json() : []))
    ])
    setContracts(c); setNeeding(n)
    if (n.length && !dealId) setDealId(n[0].deal_id)
  }

  async function createContract() {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/contracts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deal_id: dealId, terms: terms || null, renewal_date: renewalDate })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setShowNew(false); setTerms(''); setRenewalDate('')
      load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
  }

  const renewalTone = (date: string | null) => {
    if (!date) return ''
    const days = (new Date(date).getTime() - Date.now()) / 86_400_000
    return days < 30 ? 'text-amber' : ''
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-lg font-semibold">Contracts</h1>
        {canManage && needing.length > 0 && (
          <button onClick={() => setShowNew((s) => !s)} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm">+ New contract</button>
        )}
      </div>

      {showNew && (
        <div className="bg-panel border border-line rounded-xl p-4 mb-6">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-muted block mb-1">Won deal</label>
              <select value={dealId} onChange={(e) => setDealId(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full">
                {needing.map((n) => <option key={n.deal_id} value={n.deal_id}>{n.brand_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Renewal date</label>
              <input type="date" value={renewalDate} onChange={(e) => setRenewalDate(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full" />
            </div>
          </div>
          <label className="text-xs text-muted block mb-1">Terms</label>
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full h-20 mb-3" />
          <div className="text-xs text-muted mb-3">Final amount is pulled automatically from the proposal&apos;s brand-facing total.</div>
          <button onClick={createContract} disabled={saving || !dealId || !renewalDate} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">
            {saving ? 'Creating…' : 'Create contract'}
          </button>
          {error && <div className="text-red-400 text-sm mt-2">{error}</div>}
        </div>
      )}

      <div className="bg-panel border border-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted uppercase"><tr className="border-b border-line">
            <th className="text-left p-3">Brand</th><th className="text-left p-3">Final amount</th><th className="text-left p-3">Renewal</th><th className="text-left p-3">Status</th>
          </tr></thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0">
                <td className="p-3"><Link href={`/contracts/${c.id}`} className="text-blue-400 underline">{c.brand_name}</Link></td>
                <td className="p-3 font-mono">{c.currency} {Number(c.final_amount).toLocaleString()}</td>
                <td className={`p-3 font-mono ${renewalTone(c.renewal_date)}`}>{c.renewal_date ?? '—'}</td>
                <td className="p-3 capitalize">{c.status}</td>
              </tr>
            ))}
            {contracts.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted">No contracts yet — create one from a Won deal above.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
