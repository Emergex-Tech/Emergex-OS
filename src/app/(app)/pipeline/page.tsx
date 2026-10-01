'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

interface P { id: string; stage: string; brand_name: string; route_label: string; currency: string; value: number; net_margin_pct: number | null }
interface Bucket { key: string; won: number; lost: number; won_value: number; lost_value: number }
interface WonLost { by_brand: Bucket[]; by_agent: Bucket[]; by_market: Bucket[]; by_category: Bucket[]; by_reason: { reason: string; count: number }[] }

const STAGES = ['Draft', 'Review', 'Approved', 'Sent', 'Negotiating', 'Won', 'Lost']

export default function Pipeline() {
  const [proposals, setProposals] = useState<P[]>([])
  const [analysis, setAnalysis] = useState<WonLost | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/pipeline').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/analytics/won-lost').then((r) => (r.ok ? r.json() : null))
    ]).then(([p, a]) => { setProposals(p); setAnalysis(a); setLoading(false) })
  }, [])

  if (loading) return <div className="text-muted">Loading…</div>

  const byStage = (s: string) => proposals.filter((p) => p.stage === s)
  const totalOpen = proposals.filter((p) => !['Won', 'Lost'].includes(p.stage)).reduce((s, p) => s + p.value, 0)

  const Table = ({ title, rows }: { title: string; rows: Bucket[] }) => (
    <div>
      <div className="text-xs text-muted uppercase mb-2">{title}</div>
      <div className="bg-panel border border-line rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="text-muted uppercase"><tr className="border-b border-line"><th className="text-left p-2">{title}</th><th className="text-right p-2">Won</th><th className="text-right p-2">Lost</th></tr></thead>
          <tbody>
            {rows.slice(0, 8).map((r) => (
              <tr key={r.key} className="border-b border-line last:border-0">
                <td className="p-2">{r.key}</td>
                <td className="p-2 text-right text-green-400 font-mono">{r.won}</td>
                <td className="p-2 text-right text-red-400 font-mono">{r.lost}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={3} className="p-3 text-center text-muted">No closed deals yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div>
      <div className="flex justify-between items-baseline mb-5">
        <h1 className="text-lg font-semibold">Sales Pipeline</h1>
        <span className="text-sm text-muted font-mono">${totalOpen.toLocaleString()} open</span>
      </div>

      <div className="grid grid-cols-7 gap-3 mb-10">
        {STAGES.map((stage) => (
          <div key={stage}>
            <h3 className="text-xs font-mono text-muted uppercase mb-2">{stage} <span className="text-dim">({byStage(stage).length})</span></h3>
            <div className="flex flex-col gap-2">
              {byStage(stage).map((p) => (
                <Link key={p.id} href={`/proposals/${p.id}`} className="block bg-panel2 border border-line rounded-md p-2.5 text-xs hover:border-amber">
                  <div className="font-semibold mb-1">{p.brand_name}</div>
                  <div className="text-muted mb-1">{p.route_label}</div>
                  <div className="font-mono text-amber">{p.currency} {p.value.toLocaleString()}</div>
                  {p.net_margin_pct != null && <div className="font-mono text-green-400">{p.net_margin_pct.toFixed(1)}% net</div>}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <h2 className="text-sm font-semibold text-muted uppercase mb-3">Won / lost analysis</h2>
      {analysis && (
        <div className="grid grid-cols-2 gap-4">
          <Table title="By brand" rows={analysis.by_brand} />
          <Table title="By agent" rows={analysis.by_agent} />
          <Table title="By market" rows={analysis.by_market} />
          <Table title="By category" rows={analysis.by_category} />
          <div className="col-span-2">
            <div className="text-xs text-muted uppercase mb-2">Loss reasons</div>
            <div className="bg-panel border border-line rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <tbody>
                  {analysis.by_reason.map((r, i) => (
                    <tr key={i} className="border-b border-line last:border-0"><td className="p-2">{r.reason}</td><td className="p-2 text-right font-mono">{r.count}</td></tr>
                  ))}
                  {analysis.by_reason.length === 0 && <tr><td className="p-3 text-center text-muted">No lost deals yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
