import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { createRecord, hasPermission, requirePermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { computeMarginStack, resolveAgentConfig, type PricingMechanic } from '@/lib/pricing'
import { errorResponse } from '@/lib/apiError'

/**
 * A16: a negotiated COST (what the vendor agreed to) is saved back as a price record,
 * tied to the brand, route, proposal and line it came from. It survives a lost deal.
 *
 * Recording it needs only price.record_cost (Team can — that's Team's layer in the
 * approval chain). Applying it to the line changes the brand-facing price, so that
 * additionally needs margin.set, and is checked BEFORE anything is written.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, 'amount must be a positive number')

    await requirePermission(profile, 'price.record_cost')
    const applyToLine = body.apply_to_line === true
    if (applyToLine) await requirePermission(profile, 'margin.set')

    const svc = supabaseService()
    const { data: line } = await svc
      .from('proposal_lines')
      .select('id, item_id, sell_price, pricing_mechanic, proposals(id, brand_id, route_id, currency)')
      .eq('id', params.lineId).eq('proposal_id', params.id).eq('org_id', profile.org_id).single()
    if (!line) throw new ApiError(404, 'Proposal line not found')
    const proposal = line.proposals as unknown as { id: string; brand_id: string; route_id: string | null; currency: string }

    const priceRecord = await createRecord({
      profile,
      permission: 'price.record_cost',
      table: 'price_records',
      entityType: 'price_record',
      data: {
        item_id: line.item_id,
        type: 'negotiated',
        amount,
        currency: body.currency ?? proposal.currency,
        unit: body.unit ?? null,
        validity_days: body.validity_days ?? null,
        source: body.source ?? 'Negotiated on proposal',
        brand_id: proposal.brand_id,
        route_id: proposal.route_id,
        proposal_id: proposal.id,
        proposal_line_id: line.id,
        reusable: body.reusable === true // "will the vendor extend this to other brands?"
      }
    })

    let applied: { old_sell_price: number; new_sell_price: number } | null = null
    if (applyToLine) {
      if (priceRecord.currency !== proposal.currency) {
        throw new ApiError(400, `Negotiated cost is in ${priceRecord.currency} but the proposal is in ${proposal.currency}; it was recorded but not applied.`)
      }
      const { data: pricing } = await svc.from('proposal_line_pricing').select('cost_used, margin_pct').eq('proposal_line_id', line.id).single()
      if (!pricing) throw new ApiError(404, 'No pricing record for this line')

      const agent = await resolveAgentConfig(proposal.route_id)
      const stack = computeMarginStack({ cost: amount, rate: Number(pricing.margin_pct), mechanic: line.pricing_mechanic as PricingMechanic, agent })

      await svc.from('proposal_lines').update({ sell_price: stack.brandFacingPrice, updated_at: new Date().toISOString() }).eq('id', line.id)
      await svc.from('proposal_line_pricing').update({
        cost_used: amount, cost_source_price_record_id: priceRecord.id, agent_cut_amount: stack.agentCut,
        net_margin_emx: stack.netMarginEmx, net_margin_pct: stack.netMarginPct, set_by: profile.id, updated_at: new Date().toISOString()
      }).eq('proposal_line_id', line.id)

      await svc.from('proposal_approvals').insert({
        org_id: profile.org_id, proposal_line_id: line.id, layer: profile.role_key === 'ceo' ? 'ceo' : 'manager', action: 'cost_updated',
        snapshot: { old_cost: pricing.cost_used, new_cost: amount, old_sell_price: line.sell_price, new_sell_price: stack.brandFacingPrice, price_record_id: priceRecord.id },
        actor_id: profile.id
      })
      applied = { old_sell_price: Number(line.sell_price), new_sell_price: stack.brandFacingPrice }
    }

    // Team learns the price was saved, but sell-price movement is only echoed to callers who could see margin anyway.
    const canSeeMargin = await hasPermission(profile, 'margin.view')
    return NextResponse.json({ price_record_id: priceRecord.id, reusable: priceRecord.reusable, applied: canSeeMargin ? applied : applied ? { applied: true } : null }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
