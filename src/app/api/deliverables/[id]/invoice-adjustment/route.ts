import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/**
 * L10: flag a MISSED deliverable so the invoice gets adjusted for it ({flag:true, note}), or clear the flag ({flag:false}).
 * This only RECORDS the intent — it does not touch any invoice (that stays a deliberate finance action).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'project.manage')
    if (!isUuid(params.id)) throw new ApiError(404, 'Deliverable not found')
    const body = await req.json().catch(() => ({}))
    if (typeof body.flag !== 'boolean') throw new ApiError(400, 'flag must be true or false')
    const svc = supabaseService()
    const { data: d } = await svc.from('deliverables').select('id, status, invoice_adjustment').eq('id', params.id).eq('org_id', profile.org_id).maybeSingle()
    if (!d) throw new ApiError(404, 'Deliverable not found')
    if (body.flag && d.status !== 'missed') throw new ApiError(400, `Only a missed deliverable can be flagged for an invoice adjustment (this one is ${d.status})`)
    const note = body.flag ? (typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '') : null
    if (body.flag && !note) throw new ApiError(400, 'Say what the adjustment should be, so finance knows what to do')
    const { error } = await svc.from('deliverables').update({ invoice_adjustment: body.flag, adjustment_note: note, updated_at: new Date().toISOString() }).eq('id', params.id)
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: body.flag ? 'deliverable_flagged_for_invoice_adjustment' : 'deliverable_adjustment_flag_cleared', entityType: 'deliverable', entityId: params.id, after: { note } })
    return NextResponse.json({ ok: true, invoice_adjustment: body.flag, adjustment_note: note })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
