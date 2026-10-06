import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

const VALID_ROLES = ['team', 'manager', 'ceo']

/** Change a user's role. A CEO cannot be demoted by anyone but another CEO — prevents a Manager locking out the CEO. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'user.manage')
    const body = await req.json()
    if (!VALID_ROLES.includes(body.role_key)) throw new ApiError(400, `role_key must be one of ${VALID_ROLES.join(', ')}`)

    const svc = supabaseService()
    const { data: before } = await svc.from('profiles').select('*').eq('id', params.id).eq('org_id', profile.org_id).single()
    if (!before) throw new ApiError(404, 'User not found')
    if (before.role_key === 'agent') throw new ApiError(400, 'An agent account cannot change role. Disable it and create a new account instead.')
    if (before.role_key === 'ceo' && body.role_key !== 'ceo' && profile.role_key !== 'ceo') {
      throw new ApiError(403, 'Only a CEO can change another CEO\'s role')
    }

    const { data: after, error } = await svc.from('profiles').update({ role_key: body.role_key })
      .eq('id', params.id).eq('org_id', profile.org_id).select('id, full_name, email, role_key, disabled, created_at').single()
    if (error) throw new ApiError(400, error.message)

    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'user_role_changed', entityType: 'profile', entityId: params.id, before: { role_key: before.role_key }, after: { role_key: after.role_key } })
    return NextResponse.json(after)
  } catch (err) {
    return errorResponse(err)
  }
}
