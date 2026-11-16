import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

/** Self-service — anyone can change their OWN password (no user.manage needed; requirePermission is deliberately not called here). */
export async function POST(req: NextRequest) {
  try {
    // One of the very few routes an EXTERNAL user may call: it only ever changes the caller's OWN password (profile.id), never another user's.
    const profile = await requireProfile({ allowExternal: true })
    const body = await req.json()
    if (typeof body.new_password !== 'string' || body.new_password.length < 8) {
      throw new ApiError(400, 'New password must be at least 8 characters')
    }
    const { error } = await supabaseService().auth.admin.updateUserById(profile.id, { password: body.new_password })
    if (error) throw new ApiError(400, error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
