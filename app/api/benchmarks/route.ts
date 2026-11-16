import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { hasPermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { confidence, suggestSell } from '@/lib/benchmarks'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

const int = (v: string | null, name: string, lo: number, hi: number): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < lo || n > hi) throw new ApiError(400, `${name} must be a whole number from ${lo} to ${hi}`)
  return n
}

/**
 * B18 + B20. Typical COST ranges from price history, kept like-for-like (one row per unit + currency). Advisory only:
 * nothing here changes a price. With a brand, a SUGGESTED SELL range is added from that brand's tier margin band — and
 * because the tier band is Management-only data, asking for it without brand.tier.view is refused (not silently ignored).
 */
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const sp = req.nextUrl.searchParams
    const category = sp.get('category') || null
    if (category && !/^[a-z0-9_]{1,60}$/.test(category)) throw new ApiError(400, 'category is not valid')
    const market = sp.get('market')?.trim() || null
    if (market && market.length > 60) throw new ApiError(400, 'market is too long')
    const vendor = sp.get('vendor_id') || null
    if (vendor && !isUuid(vendor)) throw new ApiError(400, 'vendor_id is not valid')
    const unit = sp.get('unit')?.trim() || null
    if (unit && !/^[A-Za-z0-9_ \-]{1,40}$/.test(unit)) throw new ApiError(400, 'unit is not valid')
    const currencyRaw = sp.get('currency')?.trim().toUpperCase() || null
    if (currencyRaw && !/^[A-Z]{3}$/.test(currencyRaw)) throw new ApiError(400, 'currency must be a 3-letter code')
    const minDays = int(sp.get('min_days'), 'min_days', -3650, 3650), maxDays = int(sp.get('max_days'), 'max_days', -3650, 3650)
    if (minDays != null && maxDays != null && minDays > maxDays) throw new ApiError(400, 'min_days cannot be greater than max_days')
    const sinceDays = int(sp.get('since_days'), 'since_days', 1, 3650)
    const since = sinceDays ? new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10) : null
    const brandId = sp.get('brand_id') || null
    if (brandId && !isUuid(brandId)) throw new ApiError(400, 'brand_id is not valid')

    const svc = supabaseService()
    let band: { low: number; high: number } | null = null
    let brand: { name: string; tier: string | null; band: { low: number; high: number } | null } | null = null
    if (brandId) {
      if (!(await hasPermission(profile, 'brand.tier.view'))) throw new ApiError(403, 'Suggested sell ranges use the brand tier, which only Manager and CEO can see')
      const { data: b } = await svc.from('brands').select('name').eq('id', brandId).eq('org_id', profile.org_id).maybeSingle()
      if (!b) throw new ApiError(404, 'Brand not found')
      const { data: t } = await svc.from('brand_tier').select('tier, margin_band_low, margin_band_high').eq('brand_id', brandId).maybeSingle()
      if (t?.margin_band_low != null && t?.margin_band_high != null) band = { low: Number(t.margin_band_low), high: Number(t.margin_band_high) }
      brand = { name: b.name, tier: t?.tier ?? null, band }
    }

    const args = { p_org: profile.org_id, p_category: category, p_market: market, p_vendor: vendor, p_unit: unit, p_currency: currencyRaw, p_min_days: minDays, p_max_days: maxDays, p_since: since }
    const [cost, intel] = await Promise.all([svc.rpc('price_benchmark', args), svc.rpc('price_benchmark', { ...args, p_types: ['market_intel'] })])
    if (cost.error) throw new ApiError(500, `Could not compute the benchmark: ${cost.error.message}`)
    if (intel.error) throw new ApiError(500, `Could not compute the market reference: ${intel.error.message}`)

    type Row = { unit: string | null; currency: string; n: number; min_amount: number; p25: number; median: number; p75: number; max_amount: number; oldest: string; newest: string }
    const shape = (r: Row, withSell: boolean) => {
      const n = Number(r.n), conf = confidence(n)
      const base = { unit: r.unit, currency: r.currency, n, confidence: conf, min: Number(r.min_amount), p25: Number(r.p25), median: Number(r.median), p75: Number(r.p75), max: Number(r.max_amount), oldest: r.oldest, newest: r.newest }
      // Under 3 prices there is no honest range, so none is suggested — the number is shown with its sample size and that is all.
      const suggested_sell = withSell && band && conf !== 'insufficient' ? suggestSell(base, band) : null
      return withSell ? { ...base, suggested_sell } : base
    }
    return NextResponse.json({
      groups: ((cost.data ?? []) as Row[]).map((r) => shape(r, true)),
      market_intel: ((intel.data ?? []) as Row[]).map((r) => shape(r, false)),
      brand,
      notes: [
        'Advisory only — nothing here changes a price or a proposal.',
        'Prices are compared like-for-like: never mixed across currencies or pricing units. Market-intel prices are a separate reference, not part of the cost range.',
        'A transacted price is recorded on top of the cost it came from, so a won deal can appear in the history twice (as its cost and as its transacted price).',
        ...(brandId ? [band ? 'Suggested sell = cost quartiles plus the brand tier margin band (markup basis, before any agent cut).' : 'This brand has no tier margin band set, so no sell range can be suggested.'] : [])
      ]
    })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
