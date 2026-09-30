import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { generateTempPassword } from '@/lib/passwords'
import { errorResponse } from '@/lib/apiError'

const VALID_ROLES = ['team', 'manager', 'ceo']

/** Every account in this org — Management/CEO's user list. Team gets 403, checked server-side, not just hidden in the UI. */
export async function GET() {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'user.manage')
    const svc = supabaseService()
    const { data, error } = await svc
      .from('profiles')
      .select('id, full_name, email, role_key, disabled, created_at')
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: true })
    if (error) throw new ApiError(400, error.message)
    return NextResponse.json(data ?? [])
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * Creates the auth account AND the profile row together — a user created here can sign in
 * immediately, with no separate "run this SQL" step. That manual step still exists (see the
 * (app) layout's fallback screen) only for bootstrapping the very first user in an org, before
 * anyone holds user.manage yet.
 */
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'user.manage')
    const body = await req.json()

    const email = String(body.email ?? '').trim().toLowerCase()
    const fullName = String(body.full_name ?? '').trim()
    const role = body.role_key
    if (!email || !email.includes('@')) throw new ApiError(400, 'A valid email is required')
    if (!fullName) throw new ApiError(400, 'full_name is required')
    if (!VALID_ROLES.includes(role)) throw new ApiError(400, `role_key must be one of ${VALID_ROLES.join(', ')}`)

    const svc = supabaseService()
    const password = typeof body.password === 'string' && body.password.length >= 8 ? body.password : generateTempPassword()

    const { data: created, error: authError } = await svc.auth.admin.createUser({
      email, password, email_confirm: true, // admin-created: skip the email confirmation step entirely
      user_metadata: { full_name: fullName }
    })
    if (authError) {
      // Supabase's message for this case is a generic "already registered" — worth naming explicitly.
      throw new ApiError(authError.status === 422 ? 409 : 400, authError.status === 422 ? 'That email is already registered' : authError.message)
    }

    const { data: profileRow, error: profileError } = await svc.from('profiles').insert({
      id: created.user.id, org_id: profile.org_id, full_name: fullName, email, role_key: role
    }).select('id, full_name, email, role_key, disabled, created_at').single()

    if (profileError) {
      // The profile is what makes this a usable account in THIS org — if it fails, don't leave an orphaned auth user behind.
      await svc.auth.admin.deleteUser(created.user.id)
      throw new ApiError(400, profileError.message)
    }

    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'user_created', entityType: 'profile', entityId: profileRow.id, after: { email, role_key: role } })
    return NextResponse.json({ ...profileRow, temporary_password: password }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
