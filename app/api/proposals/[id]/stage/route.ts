import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { findUnpricedLines } from '@/lib/proposalGate'
import { errorResponse } from '@/lib/apiError'

const STAGES = ['Draft', 'Review', 'Approved', 'Sent', 'Negotiating', 'Won', 'Lost']
const GATED_STAGES = ['Approved', 'Sent'] // PRD 4/6.14: Manager "approves sending" — both need proposal.approve_send

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    const toStage = body.to_stage as string
    if (!STAGES.includes(toStage)) throw new ApiError(400, `to_stage must be one of ${STAGES.join(', ')}`)
    if (toStage === 'Lost' && !body.reason) throw new ApiError(400, 'A reason is required to mark a proposal Lost')

    const svc = supabaseService()
    const { data: proposal } = await svc.from('proposals').select('id, stage, brand_id, route_id, currency').eq('id', params.id).eq('org_id', profile.org_id).single()
    if (!proposal) throw new ApiError(404, 'Proposal not found')

    if (GATED_STAGES.includes(toStage)) {
      await requirePermission(profile, 'proposal.approve_send')

      // A13: "Block sending until priced at Manager level."
      const { count } = await svc.from('proposal_lines').select('id', { count: 'exact', head: true }).eq('proposal_id', params.id)
      if (!count) throw new ApiError(400, 'Cannot approve/send a proposal with no lines')

      const unpriced = await findUnpricedLines(params.id)
      if (unpriced.length > 0) {
        throw new ApiError(400, `Not priced at Manager level yet: ${unpriced.map((l) => l.name).join(', ')}. Set a margin or confirm each line first.`)
      }
    } else {
      await requirePermission(profile, 'record.update')
    }

    await svc.from('proposals').update({ stage: toStage, updated_at: new Date().toISOString() }).eq('id', params.id)
    await svc.from('proposal_stage_history').insert({
      org_id: profile.org_id, proposal_id: params.id, from_stage: proposal.stage, to_stage: toStage,
      reason: body.reason ?? null, changed_by: profile.id
    })
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'stage_change', entityType: 'proposal', entityId: params.id, before: { stage: proposal.stage }, after: { stage: toStage } })

    // A29: a won proposal creates the deal record — idempotent, in case of a
    // duplicate call (e.g. a double-click), not one deal per click.
    if (toStage === 'Won') {
      const { data: existingDeal } = await svc.from('deals').select('id').eq('proposal_id', params.id).maybeSingle()
      if (!existingDeal) {
        await svc.from('deals').insert({ org_id: profile.org_id, proposal_id: params.id })
      }
    }

    // A26: items move out of 'available' once a proposal actually goes out, so two proposals
    // don't both show the same inventory as free. Only fires on the FIRST move to Sent (an
    // already-Sent proposal moving to Negotiating shouldn't re-touch items a second time).
    if (toStage === 'Sent' && proposal.stage !== 'Sent') {
      const { data: lines } = await svc.from('proposal_lines').select('item_id').eq('proposal_id', params.id)
      for (const l of lines ?? []) {
        await svc.from('items').update({ availability: 'proposed' }).eq('id', l.item_id).eq('org_id', profile.org_id).eq('availability', 'available')
      }
    }

    // A30: transacted prices written back to the item on Won — the actual price the deal closed
    // at becomes the new best valid cost for next time (transacted outranks everything else in
    // bestValidCost's priority). Idempotent per line via the unique index below.
    if (toStage === 'Won') {
      const { data: lines } = await svc.from('proposal_lines').select('id, item_id').eq('proposal_id', params.id)
      const { data: pricingRows } = await svc.from('proposal_line_pricing').select('proposal_line_id, cost_used').in('proposal_line_id', (lines ?? []).map((l) => l.id))
      const costByLine = new Map((pricingRows ?? []).map((p) => [p.proposal_line_id, p.cost_used]))

      for (const l of lines ?? []) {
        const cost = costByLine.get(l.id)
        if (cost == null) continue

        // Explicit check-then-insert rather than upsert/onConflict: the uniqueness constraint is a
        // PARTIAL index (type = 'transacted' only — a line can still have several 'negotiated'
        // records, just not several 'transacted' ones), and supabase-js's upsert onConflict option
        // can't express a partial index's WHERE predicate as the conflict target, so it would never
        // actually match the index. This is the idempotency check itself, not just a fast path.
        const { data: existing } = await svc.from('price_records').select('id').eq('proposal_line_id', l.id).eq('type', 'transacted').maybeSingle()
        if (!existing) {
          const { error: priceError } = await svc.from('price_records').insert({
            org_id: profile.org_id, item_id: l.item_id, type: 'transacted', amount: cost, currency: proposal.currency ?? 'USD',
            brand_id: proposal.brand_id, route_id: proposal.route_id, proposal_id: params.id, proposal_line_id: l.id,
            source: 'Won deal', recorded_by: profile.id
          })
          // Core data integrity (the won price becomes the next best valid cost) — not best-effort
          // like Drive filing, so a failure here surfaces loudly rather than being swallowed.
          if (priceError) throw new ApiError(500, `Could not write back the transacted price: ${priceError.message}`)
        }
        // Won inventory is no longer available to offer elsewhere.
        await svc.from('items').update({ availability: 'sold' }).eq('id', l.item_id).eq('org_id', profile.org_id)
      }
    }

    return NextResponse.json({ ok: true, stage: toStage })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
