import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'route.score.approve') // same authority governs approve and reject
    const body = await req.json().catch(() => ({}))
    const svc = supabaseService()

    const { data: before } = await svc.from('route_score_changes').select('*').eq('id', params.id).single()
    if (!before) throw new ApiError(404, 'Score change not found')
    if (before.status !== 'pending') throw new ApiError(400, 'Score change is not pending')

    const { data: after, error } = await svc
      .from('route_score_changes')
      .update({ status: 'rejected', reviewed_by: profile.id })
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .select()
      .single()
    if (error) throw new ApiError(400, error.message)

    await writeAudit({
      orgId: profile.org_id, actorId: profile.id, action: 'score_change_reject',
      entityType: 'route', entityId: before.route_id, before,
      after: { ...after, reason: body.reason ?? null }
    })

    return NextResponse.json(after)
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
