'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabaseBrowser'
import ContractFinance from '@/components/ContractFinance'
import ContractFiles from '@/components/ContractFiles'

interface Deliverable { id: string; description: string; due_date: string | null; status: string; owner_name: string | null; planned_quantity: number; delivered_quantity: number; unit: string | null; pct: number }
interface ContractDetail { id: string; brand_name: string; terms: string | null; final_amount: number; currency: string; renewal_date: string | null; status: string; deliverables: Deliverable[] }

export default function ContractDetail() {
  const params = useParams<{ id: string }>()
  const [contract, setContract] = useState<ContractDetail | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [desc, setDesc] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [plannedQty, setPlannedQty] = useState('1')
  const [unit, setUnit] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [params.id])

  async function load() {
    const supabase = supabaseBrowser()
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      const { data: profile } = await supabase.from('profiles').select('role_key').eq('id', session.user.id).single()
      setRole(profile?.role_key ?? null)
    }
    const res = await fetch(`/api/contracts/${params.id}`)
    setContract(res.ok ? await res.json() : null)
  }

  async function addDeliverable() {
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/contracts/${params.id}/deliverables`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc, due_date: dueDate || null, planned_quantity: Number(plannedQty) || 1, unit: unit || null })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDesc(''); setDueDate(''); load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function record(d: Deliverable) {
    const v = window.prompt(`How many have been delivered so far? (planned: ${d.planned_quantity}${d.unit ? ' ' + d.unit : ''})`, String(d.delivered_quantity))
    if (v === null) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/deliverables/${d.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delivered_quantity: Number(v) }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  if (!contract) return <div className="text-muted">Loading…</div>
  const canManage = role === 'manager' || role === 'ceo' || role === 'management'

  return (
    <div>
      <h1 className="text-lg font-semibold mb-1">{contract.brand_name}</h1>
      <p className="text-muted text-sm mb-5">
        {contract.currency} {Number(contract.final_amount).toLocaleString()} · Renews {contract.renewal_date ?? '—'} · <span className="capitalize">{contract.status}</span>
      </p>
      {contract.terms && <p className="text-sm text-muted mb-5 whitespace-pre-wrap">{contract.terms}</p>}
      {error && <div className="text-red-400 text-sm mb-4">{error}</div>}

      <h2 className="text-sm font-semibold text-muted uppercase mb-2">Deliverables</h2>
      <div className="bg-panel border border-line rounded-xl overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted uppercase"><tr className="border-b border-line"><th className="text-left p-3">Description</th><th className="text-left p-3">Due</th><th className="text-right p-3">Delivered / planned</th><th className="text-left p-3">Status</th><th className="text-left p-3"></th></tr></thead>
          <tbody>
            {contract.deliverables.map((d) => (
              <tr key={d.id} className="border-b border-line last:border-0">
                <td className="p-3">{d.description}</td>
                <td className="p-3 font-mono text-xs">{d.due_date ?? '—'}</td>
                <td className="p-3 text-right font-mono">{d.delivered_quantity} / {d.planned_quantity} <span className="text-muted text-xs">{d.unit ?? ''}</span> <span className="text-muted text-xs">({d.pct}%)</span></td>
                <td className="p-3 text-xs capitalize">{d.status}</td>
                <td className="p-3"><button onClick={() => record(d)} disabled={busy || d.status === 'replaced'} className="text-xs text-muted underline disabled:opacity-40">Record delivery</button></td>
              </tr>
            ))}
            {contract.deliverables.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted">No deliverables yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {canManage && (
        <div className="bg-panel border border-line rounded-xl p-4">
          <div className="text-xs text-muted uppercase mb-2">Add deliverable</div>
          <div className="flex gap-2">
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description" className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm flex-1" />
            <input type="number" min="0" step="any" value={plannedQty} onChange={(e) => setPlannedQty(e.target.value)} title="Planned quantity" className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-24" />
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="unit" className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-24" />
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm" />
            <button onClick={addDeliverable} disabled={busy || !desc.trim()} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">Add</button>
          </div>
        </div>
      )}
      {canManage && <ContractFiles contractId={contract.id} />}
      {canManage && <ContractFinance contractId={contract.id} />}
    </div>
  )
}
