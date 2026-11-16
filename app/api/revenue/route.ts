import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, hasPermission } from '@/lib/serviceLayer'
import { loadRevenueData, loadWeights, loadPlan } from '@/lib/revenueService'
import { revenueByMonth, marginByDimension, reconciliation, weightedForecast, variance, monthsBetween, defaultRange, isMonth, DIMENSIONS } from '@/lib/revenue'
import { errorResponse } from '@/lib/apiError'

/**
 * PRD 6.23. Booked / invoiced / collected by month with variance against plan, margin by brand, agent, market, category, vendor and
 * owner, and the weighted-pipeline forecast — for ONE currency (currencies are never added together). CEO, Manager and Management.
 * ?from=YYYY-MM&to=YYYY-MM&currency=USD   (default: the last 12 months, in the currency with the most booked revenue)
 */
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'revenue.view')
    const sp = req.nextUrl.searchParams, def = defaultRange(new Date().toISOString().slice(0, 10))
    const from = sp.get('from') ?? def.from, to = sp.get('to') ?? def.to
    if (!isMonth(from) || !isMonth(to)) throw new ApiError(400, 'from and to must be months, like 2026-11')
    const months = monthsBetween(from, to)
    if (months.length === 0) throw new ApiError(400, 'from must not be after to')
    if (months.length > 60) throw new ApiError(400, 'Choose a range of at most 60 months')
    const data = await loadRevenueData(profile.org_id)
    const asked = sp.get('currency')
    if (asked != null && !/^[A-Z]{3}$/.test(asked)) throw new ApiError(400, 'currency must be a 3-letter code such as USD')
    const biggest = data.currencies.map((c) => ({ c, v: data.deals.filter((d) => d.currency === c).reduce((s, d) => s + d.finalAmount, 0) })).sort((a, b) => b.v - a.v)[0]?.c
    const currency = asked ?? biggest ?? 'USD'
    const rev = revenueByMonth(data.deals, data.invoices, data.payments, currency, months)
    const [weights, plan] = await Promise.all([loadWeights(profile.org_id), loadPlan(profile.org_id, currency, from, to)])
    return NextResponse.json({
      range: { from, to }, currency, currencies: data.currencies, can_plan: await hasPermission(profile, 'revenue.plan'),
      months: variance(rev.months, plan), totals: rev.totals, outstanding: rev.outstanding, plan,
      margins: Object.fromEntries(DIMENSIONS.map((d) => [d, marginByDimension(data.deals, currency, d, months)])),
      forecast: weightedForecast(data.open, weights, currency), weights,
      reconciliation: reconciliation(data.deals, currency)
    })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
