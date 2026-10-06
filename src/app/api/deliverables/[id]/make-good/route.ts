import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { isValidIsoDate } from '@/lib/billing'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/**
 * L10: replace a MISSED deliverable with a make-good. Creates the replacement (default quantity: what was still owed),
 * then marks the original 'replaced' — the original then drops out of the delivery % and the make-good counts instead.
 * A deliverable is either made good OR flagged for an invoice adjustment, not both.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'project.manage')
    if (!isUuid(params.id)) throw new ApiError(404, 'Deliverable not found')
    const body = await req.json().catch(() => ({}))
    const svc = supabaseService()
    const { data: orig } = await svc.from('deliverables').select('*').eq('id', params.id).eq('org_id', profile.org_id).maybeSingle()
    if (!orig) throw new ApiError(404, 'Deliverable not found')
    if (orig.status === 'replaced') throw new ApiError(409, 'This deliverable already has a make-good')
    if (orig.status !== 'missed') throw new ApiError(400, `Only a missed deliverable can have a make-good (this one is ${orig.status})`)
    if (orig.invoice_adjustment) throw new ApiError(400, 'This deliverable is flagged for an invoice adjustment — clear that first if you would rather make it good')
    const owed = Math.round((Number(orig.planned_quantity) - Number(orig.delivered_quantity)) * 100) / 100
    const qty = body.planned_quantity != null ? Number(body.planned_quantity) : owed
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1e9) throw new ApiError(400, 'planned_quantity must be greater than zero')
    if (body.due_date != null && !isValidIsoDate(String(body.due_date))) throw new ApiError(400, 'due_date must be a valid date (YYYY-MM-DD)')
    const description = (typeof body.description === 'string' && body.description.trim()) ? body.description.trim().slice(0, 300) : `Make-good: ${orig.description}`.slice(0, 300)

    const { data: mg, error } = await svc.from('deliverables').insert({
      org_id: profile.org_id, contract_id: orig.contract_id, description, planned_quantity: qty, unit: orig.unit, owner_id: orig.owner_id, due_date: body.due_date ?? null, make_good_of: orig.id, created_by: profile.id
    }).select('*').single()
    if (error) throw new ApiError(400, error.message)
    const { error: e2 } = await svc.from('deliverables').update({ status: 'replaced', updated_at: new Date().toISOString() }).eq('id', orig.id).eq('status', 'missed')
    if (e2) { await svc.from('deliverables').delete().eq('id', mg.id); throw new ApiError(500, 'Could not complete the make-good, so nothing was changed') }
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'deliverable_make_good', entityType: 'deliverable', entityId: orig.id, after: { make_good_id: mg.id, planned_quantity: qty } })
    return NextResponse.json({ make_good: { ...mg, planned_quantity: Number(mg.planned_quantity), delivered_quantity: 0 }, original_status: 'replaced' }, { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
