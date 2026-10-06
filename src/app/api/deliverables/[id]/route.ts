import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { statusForQuantity, deliveryPct, type DeliveryStatus } from '@/lib/delivery'
import { assertStaff } from '@/lib/projectService'
import { isValidIsoDate } from '@/lib/billing'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

const TERMS = ['planned_quantity', 'description', 'due_date', 'owner_id', 'unit']
const num = (v: unknown, name: string) => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new ApiError(400, `${name} must be a number from 0 to 1,000,000,000`); return Math.round(n * 100) / 100 }

/**
 * Three kinds of change, each with its own gate:
 *  • delivered_quantity — recording what was delivered is operational work (Team can: record.update)
 *  • status:'missed'    — commercial consequences (a make-good, an invoice adjustment), so Manager/CEO (project.manage)
 *  • the terms (planned_quantity, description, due_date, owner_id, unit) — contract.manage, as when the deliverable was created
 * Otherwise the status FOLLOWS the quantity — nobody sets "delivered" directly, so status and quantity can't disagree.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    if (!isUuid(params.id)) throw new ApiError(404, 'Deliverable not found')
    const body = await req.json().catch(() => ({}))
    const keys = Object.keys(body)
    const unknown = keys.filter((k) => !['delivered_quantity', 'status', ...TERMS].includes(k))
    if (unknown.length) throw new ApiError(400, `Unknown field: ${unknown.join(', ')}`)
    if (keys.length === 0) throw new ApiError(400, 'Nothing to change')
    if ('delivered_quantity' in body) await requirePermission(profile, 'record.update')
    if ('status' in body) { await requirePermission(profile, 'project.manage'); if (body.status !== 'missed') throw new ApiError(400, "status can only be set to 'missed' here — every other status follows from the delivered quantity") }
    if (keys.some((k) => TERMS.includes(k))) await requirePermission(profile, 'contract.manage')

    const svc = supabaseService()
    const { data: before } = await svc.from('deliverables').select('*').eq('id', params.id).eq('org_id', profile.org_id).maybeSingle()
    if (!before) throw new ApiError(404, 'Deliverable not found')
    if (before.status === 'replaced') throw new ApiError(400, 'This deliverable has been replaced by a make-good, so it is closed')

    const patch: Record<string, unknown> = {}
    let planned = Number(before.planned_quantity), delivered = Number(before.delivered_quantity)
    if ('planned_quantity' in body) { planned = num(body.planned_quantity, 'planned_quantity'); if (planned <= 0) throw new ApiError(400, 'planned_quantity must be greater than zero'); patch.planned_quantity = planned }
    if ('delivered_quantity' in body) { delivered = num(body.delivered_quantity, 'delivered_quantity'); patch.delivered_quantity = delivered }
    if ('description' in body) { const d = typeof body.description === 'string' ? body.description.trim() : ''; if (!d || d.length > 300) throw new ApiError(400, 'A description of 1–300 characters is required'); patch.description = d }
    if ('due_date' in body) { if (body.due_date !== null && !isValidIsoDate(String(body.due_date))) throw new ApiError(400, 'due_date must be a valid date (YYYY-MM-DD)'); patch.due_date = body.due_date }
    if ('owner_id' in body) patch.owner_id = body.owner_id === null ? null : await assertStaff(profile.org_id, body.owner_id)
    if ('unit' in body) { if (body.unit !== null && (typeof body.unit !== 'string' || body.unit.length > 40)) throw new ApiError(400, 'unit can be at most 40 characters'); patch.unit = body.unit || null }

    let status: DeliveryStatus
    if (body.status === 'missed') {
      if (delivered >= planned) throw new ApiError(400, 'A fully delivered deliverable cannot be marked missed')
      status = 'missed'
    } else {
      try { status = statusForQuantity(planned, delivered, before.status as DeliveryStatus) } catch (e) { throw new ApiError(400, e instanceof Error ? e.message : 'Invalid quantity') }
    }
    patch.status = status
    if (status !== 'missed') Object.assign(patch, { invoice_adjustment: false, adjustment_note: null }) // an adjustment only makes sense while it is missed

    const { data: after, error } = await svc.from('deliverables').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', params.id).select('*').single()
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'deliverable_updated', entityType: 'deliverable', entityId: params.id, before: { status: before.status, delivered_quantity: before.delivered_quantity }, after: { status: after.status, delivered_quantity: after.delivered_quantity } })
    return NextResponse.json({ ...after, planned_quantity: Number(after.planned_quantity), delivered_quantity: Number(after.delivered_quantity), pct: deliveryPct(Number(after.planned_quantity), Number(after.delivered_quantity)) })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
