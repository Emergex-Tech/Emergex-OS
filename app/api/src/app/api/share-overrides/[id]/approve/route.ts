import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'share.override.approve')
    const body = await req.json().catch(() => ({}))
    const svc = supabaseService()

    const { data: before } = await svc.from('share_conflict_overrides').select('*').eq('id', params.id).eq('org_id', profile.org_id).single()
    if (!before) throw new ApiError(404, 'Override request not found')
    if (before.status !== 'pending') throw new ApiError(400, 'This override request is not pending')

    const { data: after, error } = await svc.from('share_conflict_overrides')
      .update({ status: 'approved', decided_by: profile.id, decided_at: new Date().toISOString() })
      .eq('id', params.id).eq('org_id', profile.org_id).select().single()
    if (error) throw new ApiError(400, error.message)

    await writeAudit({
      orgId: profile.org_id, actorId: profile.id, action: 'share_override_approve', entityType: 'share_conflict_override', entityId: params.id,
      before: { status: before.status }, after: { status: after.status, note: body.reason ?? null }
    })
    return NextResponse.json(after)
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
