import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/**
 * Accept (with a reliability rating) or decline an agent's note. ONLY an accepted note with a claimed price
 * becomes a market_intel price record — and market-intel prices feed the "above known market price" warnings,
 * so an unreviewed agent's number must never get in. Each note can be reviewed exactly once.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'agent.intel.review')
    if (!isUuid(params.id)) throw new ApiError(404, 'Note not found')
    const body = await req.json().catch(() => ({}))
    if (!['accept', 'reject'].includes(body.decision)) throw new ApiError(400, "decision must be 'accept' or 'reject'")
    if (body.decision === 'accept' && !['confirmed', 'likely', 'rumour'].includes(body.reliability)) throw new ApiError(400, 'Rate the note (confirmed, likely or rumour) to accept it')

    const svc = supabaseService()
    const patch = body.decision === 'accept'
      ? { review_status: 'reviewed', reliability: body.reliability, reviewed_by: profile.id, reviewed_at: new Date().toISOString() }
      : { review_status: 'rejected', reviewed_by: profile.id, reviewed_at: new Date().toISOString() }
    // Conditional update: only a note still PENDING can be reviewed, so two reviewers can't both act on it.
    const { data: note } = await svc.from('intel_notes').update(patch).eq('id', params.id).eq('org_id', profile.org_id)
      .eq('review_status', 'pending').not('submitted_by_agent_id', 'is', null)
      .select('id, linked_type, linked_id, claimed_price, claimed_currency').maybeSingle()
    if (!note) throw new ApiError(409, 'This note was not found, is not from an agent, or has already been reviewed')

    let priceRecorded = false
    if (body.decision === 'accept' && note.claimed_price != null && note.linked_type === 'item' && note.linked_id) {
      const { error } = await svc.from('price_records').insert({
        org_id: profile.org_id, item_id: note.linked_id, type: 'market_intel', amount: note.claimed_price,
        currency: note.claimed_currency ?? 'USD', source: `agent intel:${note.id}`, recorded_by: profile.id
      })
      if (error) { // undo, so a note is never "accepted" with its price silently missing
        await svc.from('intel_notes').update({ review_status: 'pending', reliability: null, reviewed_by: null, reviewed_at: null }).eq('id', params.id)
        throw new ApiError(500, 'Could not record the price, so the note was left pending')
      }
      priceRecorded = true
    }
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: body.decision === 'accept' ? 'agent_intel_accepted' : 'agent_intel_rejected', entityType: 'intel_note', entityId: params.id, after: { reliability: body.reliability ?? null, price_recorded: priceRecorded } })
    return NextResponse.json({ ok: true, price_recorded: priceRecorded })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
