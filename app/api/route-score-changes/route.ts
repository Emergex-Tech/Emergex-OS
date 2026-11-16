import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, hasPermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

/** Lists route score changes for review — defaults to pending, the review-queue use case. */
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const status = req.nextUrl.searchParams.get('status') ?? 'pending'
    const svc = supabaseService()

    const { data, error } = await svc
      .from('route_score_changes')
      .select('id, route_id, field, old_value, new_value, status, changed_by, created_at, routes(market, route_type, brands(name))')
      .eq('org_id', profile.org_id)
      .eq('status', status)
      .order('created_at', { ascending: true })

    if (error) throw new ApiError(400, error.message)
    return NextResponse.json(data)
  } catch (err) {
    return errorResponse(err)
  }
}

// PRD 6.7: "Team enters and scores routes; score changes by Team wait for
// Management review... Agents never see their own scores." (Agent role
// doesn't exist until Stage 2B, so that last part is enforced by the RLS
// policy having no agent grant at all, not by anything in this route.)
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    const { route_id, field, new_value } = body
    if (!route_id || !field || new_value == null) throw new ApiError(400, 'route_id, field and new_value are required')
    if (!['strength', 'reliability'].includes(field)) throw new ApiError(400, "field must be 'strength' or 'reliability'")
    if (new_value < 1 || new_value > 5) throw new ApiError(400, 'new_value must be between 1 and 5')

    await requirePermission(profile, 'route.score')
    const svc = supabaseService()

    const { data: route } = await svc.from('routes').select(field).eq('id', route_id).single()
    const oldValue = route ? (route as unknown as Record<string, number>)[field] : null

    // Whoever holds route.score.approve auto-applies their own change; everyone
    // else's change is pending — checked by permission, not by role name.
    const canSelfApprove = await hasPermission(profile, 'route.score.approve')
    const status = canSelfApprove ? 'approved' : 'pending'

    const { data: change, error } = await svc.from('route_score_changes').insert({
      org_id: profile.org_id, route_id, field, old_value: oldValue, new_value, status,
      changed_by: profile.id,
      reviewed_by: status === 'approved' ? profile.id : null
    }).select().single()
    if (error) throw new ApiError(400, error.message)

    if (status === 'approved') {
      await svc.from('routes').update({ [field]: new_value }).eq('id', route_id).eq('org_id', profile.org_id)
    }

    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'score_change', entityType: 'route', entityId: route_id, after: change })

    return NextResponse.json(change, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
