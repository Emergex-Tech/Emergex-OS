import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { supabaseService } from '@/lib/supabaseServer'
import { bucketCurve, effectiveDays } from '@/lib/benchmarks'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/** B19: a property's (or one item's) prices against how many days before the event they applied. One series per (unit, currency). */
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const itemId = req.nextUrl.searchParams.get('item_id'), propertyId = req.nextUrl.searchParams.get('property_id')
    if ((!itemId && !propertyId) || (itemId && propertyId)) throw new ApiError(400, 'Give exactly one of item_id or property_id')
    if ((itemId && !isUuid(itemId)) || (propertyId && !isUuid(propertyId))) throw new ApiError(400, 'That id is not valid')
    const svc = supabaseService()

    let q = svc.from('items').select('id, properties(name, event_start)').eq('org_id', profile.org_id)
    q = itemId ? q.eq('id', itemId) : q.eq('property_id', propertyId!)
    const { data: items, error } = await q.limit(200)
    if (error) throw new ApiError(400, error.message)
    if (!items || items.length === 0) throw new ApiError(404, 'Nothing found')
    const prop = (items[0].properties as unknown as { name: string; event_start: string | null } | null)
    const eventStart = prop?.event_start ?? null

    const { data: prices, error: pErr } = await svc.from('price_records')
      .select('item_id, type, amount, currency, unit, price_date, days_to_event').in('item_id', items.map((i) => i.id)).gt('amount', 0).order('price_date', { ascending: false }).limit(3000)
    if (pErr) throw new ApiError(400, pErr.message)

    type Series = { unit: string | null; currency: string; points: { days: number; amount: number; type: string; price_date: string }[]; noDays: number }
    const series = new Map<string, Series>()
    for (const p of prices ?? []) {
      const key = `${p.unit ?? ''}|${p.currency}`
      const s: Series = series.get(key) ?? { unit: p.unit, currency: p.currency, points: [], noDays: 0 }
      const days = effectiveDays(p.days_to_event, eventStart, p.price_date)
      if (days == null) s.noDays++; else s.points.push({ days, amount: Number(p.amount), type: p.type, price_date: p.price_date })
      series.set(key, s)
    }
    return NextResponse.json({
      property: prop?.name ?? null, event_start: eventStart,
      series: Array.from(series.values()).map((s) => ({
        unit: s.unit, currency: s.currency, points: s.points, excluded_no_days: s.noDays,
        // The curve's medians use COST prices only; market-intel points are still plotted, marked by type.
        ...bucketCurve(s.points.filter((p) => p.type !== 'market_intel').map((p) => ({ days: p.days, amount: p.amount }))),
        excluded_after_event: s.points.filter((p) => p.days < 0).length
      }))
    })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
