import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, hasPermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { bestValidCost, computeMarginStack, computeWarnings, resolveAgentConfig, getPricingContext, getOtherBrandPrices, type PricingMechanic } from '@/lib/pricing'
import { errorResponse } from '@/lib/apiError'

const VALID_MECHANICS: PricingMechanic[] = ['markup', 'commission', 'fee']

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    if (!body.item_id) throw new ApiError(400, 'item_id is required')

    const mechanic: PricingMechanic = body.pricing_mechanic ?? 'markup'
    if (!VALID_MECHANICS.includes(mechanic)) throw new ApiError(400, `pricing_mechanic must be one of ${VALID_MECHANICS.join(', ')}`)

    await requirePermission(profile, 'record.create')
    const svc = supabaseService()

    const { data: proposal } = await svc.from('proposals').select('id, brand_id, route_id, currency').eq('id', params.id).eq('org_id', profile.org_id).single()
    if (!proposal) throw new ApiError(404, 'Proposal not found')

    const { data: item } = await svc.from('items').select('id, property_id, properties(category_key)').eq('id', body.item_id).single()
    if (!item) throw new ApiError(404, 'Item not found')
    const categoryKey = (item as unknown as { properties: { category_key: string } }).properties?.category_key

    // A6: pull in the best valid cost — never market_intel, per PRD 6.6.
    const cost = await bestValidCost(body.item_id, proposal.brand_id)
    if (!cost) throw new ApiError(400, 'This item has no usable cost record yet (only market intel, or nothing at all) — record a real price first.')

    // No FX conversion exists yet — a cost in one currency on a proposal in another would silently mislabel the client's price.
    if (cost.currency !== proposal.currency) {
      throw new ApiError(400, `This item's cost is in ${cost.currency} but the proposal is in ${proposal.currency}. Multi-currency conversion isn't supported yet.`)
    }

    const { data: tier } = await svc.from('brand_tier').select('margin_band_low, margin_band_high').eq('brand_id', proposal.brand_id).maybeSingle()
    const bandLow = tier ? Number(tier.margin_band_low) : 12
    const bandHigh = tier ? Number(tier.margin_band_high) : 18
    // Default rate = band midpoint for markup/commission; a sensible flat starting point for 'fee'.
    const defaultRate = mechanic === 'fee' ? Math.round(cost.amount * 0.15) : (bandLow + bandHigh) / 2

    const agentConfig = await resolveAgentConfig(proposal.route_id)
    const stack = computeMarginStack({ cost: cost.amount, rate: defaultRate, mechanic, agent: agentConfig })

    const { data: line, error: lineError } = await svc.from('proposal_lines').insert({
      org_id: profile.org_id, proposal_id: params.id, item_id: body.item_id,
      quantity: body.quantity ?? 1, sell_price: stack.brandFacingPrice, pricing_mechanic: mechanic, created_by: profile.id
    }).select().single()
    if (lineError) throw new ApiError(400, lineError.message)

    await svc.from('proposal_line_pricing').insert({
      proposal_line_id: line.id, org_id: profile.org_id, cost_used: cost.amount, cost_source_price_record_id: cost.priceRecordId,
      margin_pct: defaultRate, agent_cut_amount: stack.agentCut, net_margin_emx: stack.netMarginEmx, net_margin_pct: stack.netMarginPct, set_by: profile.id
    })

    await svc.from('proposal_approvals').insert({
      org_id: profile.org_id, proposal_line_id: line.id, layer: 'team', action: 'cost_recorded',
      snapshot: { cost: cost.amount, cost_type: cost.type, rate: defaultRate, mechanic, sell_price: stack.brandFacingPrice }, actor_id: profile.id
    })

    // A10
    const ctx = await getPricingContext({ brandId: proposal.brand_id, itemId: body.item_id, propertyId: item.property_id })
    const warnings = computeWarnings({
      ratePct: mechanic === 'fee' ? null : defaultRate, mechanic,
      marginBandLow: ctx.marginBandLow, marginBandHigh: ctx.marginBandHigh, isEdge: ctx.isEdge,
      brandFacingPrice: stack.brandFacingPrice, latestMarketIntelAmount: ctx.latestMarketIntelAmount
    })

    // A11: Media/IP items show what OTHER brands were quoted — internal only.
    const otherBrandPrices = await getOtherBrandPrices({ itemId: body.item_id, excludeProposalId: params.id, categoryKey: categoryKey ?? null })

    // D10: warnings quote the tier's margin band and market-intel prices, and other_brand_prices reveal other
    // brands' deal terms — all margin-side information Team must not see. Only margin.view holders get them.
    const canViewMargin = await hasPermission(profile, 'margin.view')
    return NextResponse.json(
      canViewMargin ? { ...line, warnings, other_brand_prices: otherBrandPrices } : line,
      { status: 201 }
    )
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
