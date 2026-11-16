'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Inv { id: string; number: string; direction: string; counterparty_name: string; amount: number; currency: string; due_date: string | null; status: string }

/** Finance for one contract: its billing schedule (receivables) and payables. Rendered for Manager/CEO only; the API enforces it regardless. */
export default function ContractFinance({ contractId }: { contractId: string }) {
  const [invoices, setInvoices] = useState<Inv[]>([])
  const [installments, setInstallments] = useState('3'); const [firstDue, setFirstDue] = useState(''); const [interval, setIntervalMonths] = useState('1')
  const [payableDue, setPayableDue] = useState('')
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('')

  useEffect(() => { load() }, [contractId])
  async function load() { const r = await fetch(`/api/invoices?contract_id=${contractId}`); setInvoices(r.ok ? await r.json() : []) }

  async function post(url: string, body: unknown, ok: (d: any) => string) {
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setNotice(ok(data)); await load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const live = invoices.filter((i) => i.status !== 'void')
  const hasSchedule = live.some((i) => i.direction === 'receivable')
  const hasPayables = live.some((i) => i.direction === 'payable')
  const inputCls = 'bg-panel2 border border-line rounded-md px-3 py-2 text-sm'

  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold text-muted uppercase mb-2">Finance</h2>
      {error && <div className="text-red-400 text-sm mb-3">{error}</div>}
      {notice && <div className="text-green-400 text-sm mb-3">{notice}</div>}

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-panel border border-line rounded-xl p-4">
          <div className="text-xs text-muted uppercase mb-2">Billing schedule</div>
          {hasSchedule ? <div className="text-sm text-muted">Already generated — see the invoices below.</div> : (
            <>
              <div className="flex gap-2 mb-2">
                <input type="number" min="1" max="60" value={installments} onChange={(e) => setInstallments(e.target.value)} className={`${inputCls} w-20`} title="Instalments" />
                <input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} className={`${inputCls} flex-1`} title="First due date" />
                <input type="number" min="1" max="12" value={interval} onChange={(e) => setIntervalMonths(e.target.value)} className={`${inputCls} w-20`} title="Months between instalments" />
              </div>
              <div className="text-xs text-muted mb-2">Instalments · first due date · months apart. The contract total is split exactly; leftover cents go on the last one.</div>
              <button disabled={busy || !firstDue} onClick={() => post(`/api/contracts/${contractId}/billing-schedule`, { installments: Number(installments), first_due_date: firstDue, interval_months: Number(interval) }, (d) => `Created ${d.invoices.length} draft invoice(s).`)} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md text-sm disabled:opacity-40">Generate schedule</button>
            </>
          )}
        </div>
        <div className="bg-panel border border-line rounded-xl p-4">
          <div className="text-xs text-muted uppercase mb-2">Payables (vendors &amp; agent)</div>
          {hasPayables ? <div className="text-sm text-muted">Already generated — see the bills below.</div> : (
            <>
              <input type="date" value={payableDue} onChange={(e) => setPayableDue(e.target.value)} className={`${inputCls} w-full mb-2`} title="Due date (optional)" />
              <div className="text-xs text-muted mb-2">One bill per vendor from the real costs, plus the agent&apos;s commission. Due date is optional here and required to approve.</div>
              <button disabled={busy} onClick={() => post(`/api/contracts/${contractId}/payables`, { due_date: payableDue || undefined }, (d) => `Created ${d.payables.length} draft bill(s).${d.warning ? ' ' + d.warning : ''}`)} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md text-sm disabled:opacity-40">Generate payables</button>
            </>
          )}
        </div>
      </div>

      <div className="bg-panel border border-line rounded-xl overflow-hidden">
        <table className="w-full text-sm"><tbody>
          {live.map((i) => (
            <tr key={i.id} className="border-b border-line last:border-0">
              <td className="p-3"><Link href={`/finance/${i.id}`} className="text-blue-400 underline font-mono">{i.number}</Link></td>
              <td className="p-3">{i.counterparty_name}</td>
              <td className="p-3 text-right font-mono">{i.currency} {i.amount.toLocaleString()}</td>
              <td className="p-3 font-mono text-xs">{i.due_date ?? '—'}</td>
              <td className="p-3 text-xs capitalize text-muted">{i.status}</td>
            </tr>
          ))}
          {live.length === 0 && <tr><td className="p-4 text-center text-muted">No invoices or bills yet.</td></tr>}
        </tbody></table>
      </div>
    </div>
  )
}
