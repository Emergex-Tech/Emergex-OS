import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { generateTempPassword } from '@/lib/passwords'
import { errorResponse } from '@/lib/apiError'

/** Admin sets a new temporary password and reads it once to hand to the user — no email dependency. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'user.manage')
    const svc = supabaseService()

    const { data: target } = await svc.from('profiles').select('id').eq('id', params.id).eq('org_id', profile.org_id).single()
    if (!target) throw new ApiError(404, 'User not found')

    const password = generateTempPassword()
    const { error } = await svc.auth.admin.updateUserById(params.id, { password })
    if (error) throw new ApiError(400, error.message)

    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'user_password_reset', entityType: 'profile', entityId: params.id })
    return NextResponse.json({ temporary_password: password })
  } catch (err) {
    return errorResponse(err)
  }
}
