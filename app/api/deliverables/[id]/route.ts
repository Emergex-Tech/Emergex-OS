import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

/** Marking a deliverable done is operational work (Team can), not a contract-terms edit — deliberately a looser gate than creating one. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    const body = await req.json()
    if (body.status && !['pending', 'done'].includes(body.status)) throw new ApiError(400, "status must be 'pending' or 'done'")

    const svc = supabaseService()
    const { data: before } = await svc.from('deliverables').select('*').eq('id', params.id).eq('org_id', profile.org_id).single()
    if (!before) throw new ApiError(404, 'Deliverable not found')

    const { data: after, error } = await svc.from('deliverables')
      .update({ status: body.status ?? before.status, updated_at: new Date().toISOString() })
      .eq('id', params.id).eq('org_id', profile.org_id).select().single()
    if (error) throw new ApiError(400, error.message)

    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'deliverable_status_changed', entityType: 'deliverable', entityId: params.id, before: { status: before.status }, after: { status: after.status } })
    return NextResponse.json(after)
  } catch (err) {
    return errorResponse(err)
  }
}

export const dynamic = 'force-dynamic'
