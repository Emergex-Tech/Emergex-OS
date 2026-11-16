import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/** A log entry cannot be edited or deleted. A wrong one is VOIDED (with a reason, once); the delivered quantity recalculates, and its links are archived with it. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; eventId: string }> }) {
  const params = await ctx.params   // Next 15+: route params arrive as a Promise
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    if (!isUuid(params.id) || !isUuid(params.eventId)) throw new ApiError(404, 'Entry not found')
    const b = await req.json().catch(() => ({}))
    const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
    if (!reason) throw new ApiError(400, 'Say why this entry is being voided')
    if (reason.length > 500) throw new ApiError(400, 'The reason can be at most 500 characters')
    const svc = supabaseService()
    const { data: ev } = await svc.from('deliverable_events').select('id, voided_at').eq('id', params.eventId).eq('deliverable_id', params.id).eq('org_id', profile.org_id).maybeSingle()
    if (!ev) throw new ApiError(404, 'Entry not found')
    if (ev.voided_at) throw new ApiError(409, 'That entry is already voided')
    const { data, error } = await svc.from('deliverable_events').update({ voided_at: new Date().toISOString(), voided_by: profile.id, void_reason: reason }).eq('id', ev.id).is('voided_at', null).select('id').maybeSingle()
    if (error) throw new ApiError(400, error.message)
    if (!data) throw new ApiError(409, 'That entry is already voided')
    await svc.from('deliverable_proofs').update({ archived_at: new Date().toISOString(), archived_by: profile.id }).eq('event_id', ev.id).is('archived_at', null)
    const { data: after } = await svc.from('deliverables').select('status, delivered_quantity').eq('id', params.id).single()
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'delivery_log_voided', entityType: 'deliverable', entityId: params.id, after: { event_id: ev.id, reason } })
    return NextResponse.json({ ok: true, deliverable: { status: after!.status, delivered_quantity: Number(after!.delivered_quantity) } })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
