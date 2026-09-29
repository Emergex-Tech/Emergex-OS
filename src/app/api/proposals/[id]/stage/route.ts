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
    const { data: proposal } = await svc.from('proposals').select('id, stage, brand_id').eq('id', params.id).eq('org_id', profile.org_id).single()
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

    return NextResponse.json({ ok: true, stage: toStage })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
