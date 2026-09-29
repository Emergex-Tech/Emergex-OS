import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { computeMarginStack, computeWarnings, resolveAgentConfig, getPricingContext, type PricingMechanic } from '@/lib/pricing'
import { errorResponse } from '@/lib/apiError'

export async function PATCH(req: NextRequest, { params }: { params: { lineId: string } }) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    if (body.rate == null) throw new ApiError(400, 'rate is required (a % for markup/commission, a flat amount for fee)')

    await requirePermission(profile, 'margin.set') // PRD 4: "Manager sets margins and sell prices"
    const svc = supabaseService()

    const { data: line } = await svc
      .from('proposal_lines')
      .select('id, item_id, proposal_id, pricing_mechanic, items(property_id), proposals(brand_id, route_id)')
      .eq('id', params.lineId).eq('org_id', profile.org_id).single()
    if (!line) throw new ApiError(404, 'Proposal line not found')

    const { data: pricing } = await svc.from('proposal_line_pricing').select('cost_used').eq('proposal_line_id', params.lineId).single()
    if (!pricing) throw new ApiError(404, 'No pricing record for this line')

    const proposalInfo = line.proposals as unknown as { brand_id: string; route_id: string | null }
    const mechanic = line.pricing_mechanic as PricingMechanic // set at line creation (A8) — not changeable here
    const agentConfig = await resolveAgentConfig(proposalInfo?.route_id ?? null)

    const stack = computeMarginStack({ cost: Number(pricing.cost_used), rate: Number(body.rate), mechanic, agent: agentConfig })

    await svc.from('proposal_lines').update({ sell_price: stack.brandFacingPrice, updated_at: new Date().toISOString() }).eq('id', params.lineId)
    await svc.from('proposal_line_pricing').update({
      margin_pct: body.rate, agent_cut_amount: stack.agentCut, net_margin_emx: stack.netMarginEmx,
      net_margin_pct: stack.netMarginPct, set_by: profile.id, updated_at: new Date().toISOString()
    }).eq('proposal_line_id', params.lineId)

    const layer = profile.role_key === 'ceo' ? 'ceo' : 'manager'
    await svc.from('proposal_approvals').insert({
      org_id: profile.org_id, proposal_line_id: params.lineId, layer, action: 'margin_set',
      snapshot: { rate: body.rate, mechanic, sell_price: stack.brandFacingPrice, net_margin_pct: stack.netMarginPct }, actor_id: profile.id
    })

    const propertyId = (line.items as unknown as { property_id: string })?.property_id
    const ctx = await getPricingContext({ brandId: proposalInfo.brand_id, itemId: line.item_id, propertyId })
    const warnings = computeWarnings({
      ratePct: mechanic === 'fee' ? null : Number(body.rate), mechanic,
      marginBandLow: ctx.marginBandLow, marginBandHigh: ctx.marginBandHigh, isEdge: ctx.isEdge,
      brandFacingPrice: stack.brandFacingPrice, latestMarketIntelAmount: ctx.latestMarketIntelAmount
    })

    return NextResponse.json({ ok: true, sell_price: stack.brandFacingPrice, net_margin_pct: stack.netMarginPct, warnings })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
