'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Inv {
  id: string; number: string; direction: string; counterparty_name: string; description: string | null; currency: string
  amount: number; paid: number; balance: number; due_date: string | null; status: string; payment_status: string
  overdue: boolean; days_overdue: number; needs_chase: boolean
}
type Tab = 'receivable' | 'payable' | 'overdue'

export default function Finance() {
  const [tab, setTab] = useState<Tab>('receivable')
  const [all, setAll] = useState<Inv[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/invoices').then(async (r) => {
      if (r.status === 403) { setForbidden(true); setLoading(false); return }
      setAll(r.ok ? await r.json() : [])
      setLoading(false)
    })
  }, [])

  async function download(kind: 'receivables' | 'payables' | 'payments') {
    setError('')
    const res = await fetch(`/api/finance/export?kind=${kind}`)
    if (!res.ok) { setError((await res.json()).error); return }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(await res.blob()); a.download = `emergex-${kind}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  if (loading) return <div className="text-muted">Loading…</div>
  if (forbidden) return <div className="text-muted">Finance is restricted to Manager and CEO.</div>

  const live = all.filter((i) => i.status !== 'void')
  const rows = tab === 'overdue' ? live.filter((i) => i.overdue).sort((a, b) => b.days_overdue - a.days_overdue) : live.filter((i) => i.direction === tab)
  const sum = (dir: string, f: (i: Inv) => number) => live.filter((i) => i.direction === dir && i.status === 'issued').reduce((s, i) => s + f(i), 0)
  const overdueTotal = live.filter((i) => i.overdue && i.direction === 'receivable').reduce((s, i) => s + i.balance, 0)

  const Card = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
    <div className="bg-panel border border-line rounded-xl p-4"><div className="text-xs font-mono text-muted uppercase">{label}</div><div className={`text-xl font-semibold mt-1.5 ${tone ?? ''}`}>{value}</div></div>
  )

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-lg font-semibold">Finance</h1>
        <div className="flex gap-2 text-xs">
          {(['receivables', 'payables', 'payments'] as const).map((k) => <button key={k} onClick={() => download(k)} className="border border-line px-3 py-1.5 rounded capitalize">Export {k} (CSV)</button>)}
        </div>
      </div>
      {error && <div className="text-red-400 text-sm mb-3">{error}</div>}

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card label="Owed to us (issued)" value={`$${sum('receivable', (i) => i.balance).toLocaleString()}`} />
        <Card label="We owe (issued)" value={`$${sum('payable', (i) => i.balance).toLocaleString()}`} />
        <Card label="Overdue receivables" value={`$${overdueTotal.toLocaleString()}`} tone={overdueTotal > 0 ? 'text-red-400' : ''} />
      </div>

      <div className="flex gap-2 mb-4">
        {([['receivable', 'Receivables'], ['payable', 'Payables'], ['overdue', 'Overdue']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded text-sm ${tab === k ? 'bg-amber text-black font-semibold' : 'border border-line text-muted'}`}>{label}</button>
        ))}
      </div>

      <div className="bg-panel border border-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted uppercase"><tr className="border-b border-line">
            <th className="text-left p-3">Number</th><th className="text-left p-3">{tab === 'payable' ? 'Payee' : 'Billed to'}</th><th className="text-left p-3">Description</th>
            <th className="text-right p-3">Amount</th><th className="text-right p-3">Balance</th><th className="text-left p-3">Due</th><th className="text-left p-3">Status</th>
          </tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} className="border-b border-line last:border-0">
                <td className="p-3"><Link href={`/finance/${i.id}`} className="text-blue-400 underline font-mono">{i.number}</Link></td>
                <td className="p-3">{i.counterparty_name}</td><td className="p-3 text-xs text-muted">{i.description}</td>
                <td className="p-3 text-right font-mono">{i.currency} {i.amount.toLocaleString()}</td>
                <td className="p-3 text-right font-mono">{i.balance.toLocaleString()}</td>
                <td className="p-3 font-mono text-xs">{i.due_date ?? '—'}</td>
                <td className="p-3 text-xs">
                  {i.overdue ? <span className="text-red-400">{i.days_overdue}d overdue{i.needs_chase ? ' · chase due' : ''}</span>
                    : i.status === 'draft' ? <span className="text-muted">Draft</span>
                    : i.payment_status === 'paid' ? <span className="text-green-400">Paid</span>
                    : i.payment_status === 'part_paid' ? <span className="text-amber">Part paid</span> : <span>Issued</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted">{tab === 'overdue' ? 'Nothing overdue.' : 'None yet — generate them from a contract.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
