'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface Detail {
  id: string; number: string; direction: string; counterparty_name: string; description: string | null; currency: string
  amount: number; paid: number; balance: number; issue_date: string | null; due_date: string | null; status: string
  payment_status: string; overdue: boolean; days_overdue: number; needs_chase: boolean
  payments: { id: string; amount: number; paid_on: string; method: string | null; reference: string | null; recorded_by: { full_name: string } | null }[]
  chases: { id: string; note: string | null; created_at: string; chased_by: { full_name: string } | null }[]
}

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>()
  const [inv, setInv] = useState<Detail | null>(null)
  const [amount, setAmount] = useState(''); const [method, setMethod] = useState(''); const [reference, setReference] = useState('')
  const [dueDate, setDueDate] = useState(''); const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')

  useEffect(() => { load() }, [id])
  async function load() { const r = await fetch(`/api/invoices/${id}`); setInv(r.ok ? await r.json() : null) }

  async function act(url: string, method_: string, body: unknown) {
    setBusy(true); setError('')
    try {
      const res = await fetch(url, { method: method_, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setAmount(''); setMethod(''); setReference(''); setNote('')
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  if (!inv) return <div className="text-muted">Loading…</div>
  const receivable = inv.direction === 'receivable'

  return (
    <div className="max-w-3xl">
      <h1 className="text-lg font-semibold font-mono">{inv.number}</h1>
      <p className="text-muted text-sm mb-1">{receivable ? 'Billed to' : 'Payable to'} <b className="text-white">{inv.counterparty_name}</b> · {inv.description}</p>
      <p className="text-sm mb-5">
        <span className="font-mono">{inv.currency} {inv.amount.toLocaleString()}</span> · paid {inv.paid.toLocaleString()} · <b>balance {inv.balance.toLocaleString()}</b> · due {inv.due_date ?? '—'}{' '}
        {inv.overdue && <span className="text-red-400">· {inv.days_overdue} days overdue</span>}{' '}
        <span className="text-muted capitalize">· {inv.status === 'issued' ? inv.payment_status.replace('_', ' ') : inv.status}</span>
      </p>
      {error && <div className="bg-[#211510] border border-[#4d321b] text-amber rounded-md p-3 text-sm mb-4">{error}</div>}

      {inv.status === 'draft' && (
        <div className="bg-panel border border-line rounded-xl p-4 mb-4 flex gap-2 items-end">
          <div><label className="text-xs text-muted block mb-1">Due date {inv.due_date ? '(optional — change it)' : '(required)'}</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm" /></div>
          <button disabled={busy} onClick={() => act(`/api/invoices/${id}`, 'PATCH', { action: 'issue', due_date: dueDate || undefined })} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">{receivable ? 'Issue invoice' : 'Approve bill'}</button>
          <button disabled={busy} onClick={() => act(`/api/invoices/${id}`, 'PATCH', { action: 'void' })} className="border border-line px-4 py-2 rounded-md text-sm disabled:opacity-40">Void</button>
        </div>
      )}

      {inv.status === 'issued' && inv.balance > 0 && (
        <div className="bg-panel border border-line rounded-xl p-4 mb-4">
          <div className="text-xs text-muted uppercase mb-2">Record a payment</div>
          <div className="flex gap-2">
            <input type="number" step="0.01" placeholder={`Amount (max ${inv.balance})`} value={amount} onChange={(e) => setAmount(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-40" />
            <input placeholder="Method" value={method} onChange={(e) => setMethod(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-36" />
            <input placeholder="Reference" value={reference} onChange={(e) => setReference(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm flex-1" />
            <button disabled={busy || !amount} onClick={() => act(`/api/invoices/${id}/payments`, 'POST', { amount: Number(amount), method: method || null, reference: reference || null })} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">Record</button>
          </div>
        </div>
      )}

      {inv.overdue && (
        <div className="bg-[#211510] border border-[#4d321b] rounded-xl p-4 mb-4">
          <div className="text-sm text-amber mb-2">{inv.needs_chase ? 'A chase is due — nobody has chased this in the last 7 days.' : 'Chased recently.'}</div>
          <div className="flex gap-2">
            <input placeholder="What did you do? (e.g. emailed accounts)" value={note} onChange={(e) => setNote(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm flex-1" />
            <button disabled={busy} onClick={() => act(`/api/invoices/${id}/chase`, 'POST', { note: note || null })} className="border border-line px-4 py-2 rounded-md text-sm disabled:opacity-40">Log chase</button>
          </div>
        </div>
      )}

      <h2 className="text-xs font-mono text-muted uppercase mb-2">Payments ({inv.payments.length})</h2>
      <div className="bg-panel border border-line rounded-xl overflow-hidden mb-5"><table className="w-full text-sm"><tbody>
        {inv.payments.map((p) => (<tr key={p.id} className="border-b border-line last:border-0"><td className="p-3 font-mono text-xs">{p.paid_on}</td><td className="p-3 font-mono">{p.amount.toLocaleString()}</td><td className="p-3 text-muted text-xs">{p.method ?? ''} {p.reference ?? ''}</td><td className="p-3 text-muted text-xs text-right">{p.recorded_by?.full_name}</td></tr>))}
        {inv.payments.length === 0 && <tr><td className="p-4 text-center text-muted">No payments yet.</td></tr>}
      </tbody></table></div>

      <h2 className="text-xs font-mono text-muted uppercase mb-2">Chase history ({inv.chases.length})</h2>
      <div className="bg-panel border border-line rounded-xl overflow-hidden"><table className="w-full text-sm"><tbody>
        {inv.chases.map((c) => (<tr key={c.id} className="border-b border-line last:border-0"><td className="p-3 font-mono text-xs">{new Date(c.created_at).toLocaleDateString()}</td><td className="p-3">{c.note}</td><td className="p-3 text-muted text-xs text-right">{c.chased_by?.full_name}</td></tr>))}
        {inv.chases.length === 0 && <tr><td className="p-4 text-center text-muted">Not chased.</td></tr>}
      </tbody></table></div>
    </div>
  )
}
