'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Summary {
  inventory: { total_value: number; expiring_14d: number; edge_count: number; stale_count: number }
  pipeline_by_stage: { stage: string; count: number; value: number }[]
  brands_agents: { route_count_by_type: Record<string, number>; conflicts_pending: number; conflicts_overridden: number }
  pricing: {
    signoff_queue: { line_id: string; proposal_id: string; brand_name: string; item_name: string; margin_pct: number; sell_price: number; currency: string; pricing_mechanic: string; last_action_at: string }[]
    recent_vendor_rate_changes: { item_name: string; type: string; amount: number; currency: string; price_date: string }[]
  }
  team: { recent_activity: { at: string; actor: string | null; action: string; entity_type: string }[]; pending_route_scores: number; pending_overrides: number; pending_share_overrides: number }
}

export default function CeoView() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/ceo-view').then(async (r) => {
      if (r.status === 403) { setForbidden(true); setLoading(false); return }
      setSummary(r.ok ? await r.json() : null)
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-muted">Loading…</div>
  if (forbidden) return <div className="text-muted">The CEO view is restricted to the CEO role.</div>
  if (!summary) return <div className="text-red-400">Could not load the CEO view.</div>

  const Card = ({ label, value, tone }: { label: string; value: string | number; tone?: string }) => (
    <div className="bg-panel border border-line rounded-xl p-4">
      <div className="text-xs font-mono text-muted uppercase">{label}</div>
      <div className={`text-2xl font-semibold mt-1.5 ${tone ?? ''}`}>{value}</div>
    </div>
  )

  return (
    <div>
      <h1 className="text-lg font-semibold mb-5">CEO View</h1>

      <h2 className="text-xs font-mono text-muted uppercase mb-2">Inventory</h2>
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Card label="Total value" value={`$${summary.inventory.total_value.toLocaleString()}`} />
        <Card label="Expiring (14d)" value={summary.inventory.expiring_14d} tone={summary.inventory.expiring_14d > 0 ? 'text-amber' : ''} />
        <Card label="Edge properties" value={summary.inventory.edge_count} />
        <Card label="Stale" value={summary.inventory.stale_count} tone={summary.inventory.stale_count > 0 ? 'text-red-400' : ''} />
      </div>

      <h2 className="text-xs font-mono text-muted uppercase mb-2">Brands &amp; agents</h2>
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-panel border border-line rounded-xl p-4">
          <div className="text-xs font-mono text-muted uppercase mb-2">Route mix</div>
          {Object.entries(summary.brands_agents.route_count_by_type).map(([type, count]) => (
            <div key={type} className="flex justify-between text-sm py-1"><span className="capitalize">{type.replace(/_/g, ' ')}</span><span className="font-mono">{count}</span></div>
          ))}
        </div>
        <Card label="Conflicts pending" value={summary.brands_agents.conflicts_pending} tone={summary.brands_agents.conflicts_pending > 0 ? 'text-amber' : ''} />
        <Card label="Conflicts overridden" value={summary.brands_agents.conflicts_overridden} />
      </div>

      <h2 className="text-xs font-mono text-muted uppercase mb-2">Pipeline by stage</h2>
      <div className="bg-panel border border-line rounded-xl overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted uppercase"><tr className="border-b border-line"><th className="text-left p-3">Stage</th><th className="text-right p-3">Count</th><th className="text-right p-3">Value</th></tr></thead>
          <tbody>
            {summary.pipeline_by_stage.map((s) => (
              <tr key={s.stage} className="border-b border-line last:border-0"><td className="p-3">{s.stage}</td><td className="p-3 text-right font-mono">{s.count}</td><td className="p-3 text-right font-mono">${s.value.toLocaleString()}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-xs font-mono text-muted uppercase mb-2">Pricing sign-off queue <span className="text-dim">({summary.pricing.signoff_queue.length})</span></h2>
      <div className="bg-panel border border-line rounded-xl overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted uppercase"><tr className="border-b border-line"><th className="text-left p-3">Brand</th><th className="text-left p-3">Item</th><th className="text-left p-3">Mechanic</th><th className="text-right p-3">Rate</th><th className="text-right p-3">Sell price</th><th className="text-left p-3"></th></tr></thead>
          <tbody>
            {summary.pricing.signoff_queue.map((l) => (
              <tr key={l.line_id} className="border-b border-line last:border-0">
                <td className="p-3">{l.brand_name}</td><td className="p-3">{l.item_name}</td><td className="p-3 text-xs text-muted">{l.pricing_mechanic}</td>
                <td className="p-3 text-right font-mono">{l.margin_pct}{l.pricing_mechanic === 'fee' ? '' : '%'}</td>
                <td className="p-3 text-right font-mono">{l.currency} {l.sell_price.toLocaleString()}</td>
                <td className="p-3"><Link href={`/proposals/${l.proposal_id}`} className="text-blue-400 underline text-xs">Review</Link></td>
              </tr>
            ))}
            {summary.pricing.signoff_queue.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted">Nothing pending sign-off.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="text-xs font-mono text-muted uppercase mb-2">Recent vendor rate changes <span className="text-dim">(7d)</span></h2>
      <div className="bg-panel border border-line rounded-xl overflow-hidden mb-6">
        <table className="w-full text-xs">
          <tbody>
            {summary.pricing.recent_vendor_rate_changes.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="p-2">{r.item_name}</td><td className="p-2 text-muted">{r.type}</td>
                <td className="p-2 text-right font-mono">{r.currency} {r.amount.toLocaleString()}</td>
                <td className="p-2 text-right font-mono text-muted">{new Date(r.price_date).toLocaleDateString()}</td>
              </tr>
            ))}
            {summary.pricing.recent_vendor_rate_changes.length === 0 && <tr><td className="p-3 text-center text-muted">No rate changes this week.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="text-xs font-mono text-muted uppercase mb-2">Team</h2>
      <div className="grid grid-cols-3 gap-4 mb-3">
        <Card label="Pending route scores" value={summary.team.pending_route_scores} />
        <Card label="Pending overrides" value={summary.team.pending_overrides} />
        <Card label="Pending share overrides" value={summary.team.pending_share_overrides} />
      </div>
      <div className="bg-panel border border-line rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <tbody>
            {summary.team.recent_activity.map((a, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="p-2 font-mono text-muted">{new Date(a.at).toLocaleString()}</td>
                <td className="p-2">{a.actor ?? 'System'}</td>
                <td className="p-2">{a.action}</td>
                <td className="p-2 text-muted">{a.entity_type}</td>
              </tr>
            ))}
            {summary.team.recent_activity.length === 0 && <tr><td className="p-3 text-center text-muted">No activity yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
