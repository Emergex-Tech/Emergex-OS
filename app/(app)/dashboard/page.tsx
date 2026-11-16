'use client'
import { useEffect, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

interface Stats {
  staleProperties: number
  staleItems: number
  expiringOffers: number
  pendingScoreChanges: number
  pendingOverrides: number
  recentPriceChanges: number
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    const supabase = supabaseBrowser()
    async function load() {
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const soon = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)

      const [sp, si, offers, scores, overrides, prices] = await Promise.all([
        supabase.from('properties').select('id', { count: 'exact', head: true }).eq('is_stale', true),
        supabase.from('items').select('id', { count: 'exact', head: true }).eq('is_stale', true),
        supabase.from('items').select('id', { count: 'exact', head: true }).lte('offer_expiry', soon).gte('offer_expiry', new Date().toISOString().slice(0, 10)),
        supabase.from('route_score_changes').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('reconfirmation_overrides').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('price_records').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo)
      ])

      setStats({
        staleProperties: sp.count ?? 0,
        staleItems: si.count ?? 0,
        expiringOffers: offers.count ?? 0,
        pendingScoreChanges: scores.count ?? 0,
        pendingOverrides: overrides.count ?? 0,
        recentPriceChanges: prices.count ?? 0
      })
    }
    load()
  }, [])

  if (!stats) return <div className="text-muted">Loading…</div>

  const Card = ({ label, value }: { label: string; value: number }) => (
    <div className="bg-panel border border-line rounded-xl p-4">
      <div className="text-xs font-mono text-muted uppercase">{label}</div>
      <div className="text-2xl font-semibold mt-1.5">{value}</div>
    </div>
  )

  return (
    <div>
      <h1 className="text-lg font-semibold mb-5">Dashboard</h1>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <Card label="Stale properties" value={stats.staleProperties} />
        <Card label="Stale items" value={stats.staleItems} />
        <Card label="Offers expiring (14d)" value={stats.expiringOffers} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Card label="Pending route score changes" value={stats.pendingScoreChanges} />
        <Card label="Pending lengthening overrides" value={stats.pendingOverrides} />
        <Card label="Price changes (7d)" value={stats.recentPriceChanges} />
      </div>
    </div>
  )
}
