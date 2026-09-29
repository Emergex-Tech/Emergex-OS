import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

export async function PATCH(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'route.score.approve')
    const svc = supabaseService()

    const { data: change } = await svc.from('route_score_changes').select('*').eq('id', params.id).single()
    if (!change) throw new ApiError(404, 'Score change not found')
    if (change.status !== 'pending') throw new ApiError(400, 'Score change is not pending')

    await svc.from('routes').update({ [change.field]: change.new_value }).eq('id', change.route_id).eq('org_id', profile.org_id)

    const { data: after } = await svc
      .from('route_score_changes')
      .update({ status: 'approved', reviewed_by: profile.id })
      .eq('id', params.id)
      .select()
      .single()

    await writeAudit({
      orgId: profile.org_id, actorId: profile.id, action: 'score_change_approve',
      entityType: 'route', entityId: change.route_id, before: change, after
    })

    return NextResponse.json(after)
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
