import { NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { hasPermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { computeWarnings, getPricingContext, getOtherBrandPrices, type PricingMechanic } from '@/lib/pricing'
import { errorResponse } from '@/lib/apiError'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const svc = supabaseService()

    const { data: proposal, error } = await svc
      .from('proposals')
      .select('*, brands(name), routes(route_type, market, cut_method, cut_pct, fixed_fee, agents(name, cut_method, cut_pct, fixed_fee))')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()
    if (error || !proposal) throw new ApiError(404, 'Proposal not found')

    const { data: lines } = await svc
      .from('proposal_lines')
      .select('id, item_id, quantity, sell_price, pricing_mechanic, created_at, items(name, property_id, properties(category_key))')
      .eq('proposal_id', params.id)
      .order('created_at', { ascending: true })

    // D10 default: margin breakdown is Management-tier only (see migration
    // 003's comment). Checked here, server-side, per request — a Team
    // caller's response simply won't include a `pricing` key on any line,
    // not a hidden field the client happens not to render.
    const canViewMargin = await hasPermission(profile, 'margin.view')
    let pricingByLine: Record<string, { margin_pct: number; cost_used: number; agent_cut_amount: number; net_margin_emx: number; net_margin_pct: number }> = {}
    if (canViewMargin && lines && lines.length > 0) {
      const { data: pricing } = await svc
        .from('proposal_line_pricing')
        .select('*')
        .in('proposal_line_id', lines.map((l) => l.id))
      pricingByLine = Object.fromEntries((pricing ?? []).map((p) => [p.proposal_line_id, p]))
    }

    // A10: recompute warnings for display — these are live, not persisted,
    // so they always reflect the current tier band / edge flag / market intel.
    const enrichedLines = await Promise.all((lines ?? []).map(async (l) => {
      const pricing = pricingByLine[l.id]
      const itemInfo = l.items as unknown as { property_id: string; properties: { category_key: string } | null }
      let warnings: string[] = []
      let otherBrandPrices: { brand: string; sell_price: number }[] = []
      if (canViewMargin && pricing) {
        const ctx = await getPricingContext({ brandId: proposal.brand_id, itemId: l.item_id, propertyId: itemInfo?.property_id })
        warnings = computeWarnings({
          ratePct: l.pricing_mechanic === 'fee' ? null : Number(pricing.margin_pct),
          mechanic: l.pricing_mechanic as PricingMechanic,
          marginBandLow: ctx.marginBandLow, marginBandHigh: ctx.marginBandHigh, isEdge: ctx.isEdge,
          brandFacingPrice: Number(l.sell_price), latestMarketIntelAmount: ctx.latestMarketIntelAmount
        })
        otherBrandPrices = await getOtherBrandPrices({ itemId: l.item_id, excludeProposalId: params.id, categoryKey: itemInfo?.properties?.category_key ?? null })
      }
      return { ...l, pricing: canViewMargin ? (pricing ?? null) : undefined, warnings, other_brand_prices: otherBrandPrices }
    }))

    return NextResponse.json({ ...proposal, lines: enrichedLines, can_view_margin: canViewMargin })
  } catch (err) {
    return errorResponse(err)
  }
}


// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
