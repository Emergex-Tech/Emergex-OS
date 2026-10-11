import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

/** Revokes sign-in access. Banning at the auth level (not just a profile flag) also cuts off an active session. */
export async function PATCH(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'user.manage')
    if (params.id === profile.id) throw new ApiError(400, 'You cannot disable your own account')
    const svc = supabaseService()

    const { data: target } = await svc.from('profiles').select('role_key').eq('id', params.id).eq('org_id', profile.org_id).single()
    if (!target) throw new ApiError(404, 'User not found')
    if (target.role_key === 'ceo' && profile.role_key !== 'ceo') throw new ApiError(403, 'Only a CEO can disable another CEO')

    const { error: authError } = await svc.auth.admin.updateUserById(params.id, { ban_duration: '876000h' }) // ~100 years
    if (authError) throw new ApiError(400, authError.message)

    const { data: after, error } = await svc.from('profiles').update({ disabled: true })
      .eq('id', params.id).eq('org_id', profile.org_id).select('id, full_name, email, role_key, disabled').single()
    if (error) throw new ApiError(400, error.message)

    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'user_disabled', entityType: 'profile', entityId: params.id })
    return NextResponse.json(after)
  } catch (err) {
    return errorResponse(err)
  }
}
