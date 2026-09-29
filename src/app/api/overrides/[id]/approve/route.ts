import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

export async function PATCH(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'override.lengthen.approve')
    const svc = supabaseService()

    const { data: before } = await svc.from('reconfirmation_overrides').select('*').eq('id', params.id).single()
    if (!before) throw new ApiError(404, 'Override not found')
    if (before.status !== 'pending') throw new ApiError(400, 'Override is not pending')

    const { data: after, error } = await svc
      .from('reconfirmation_overrides')
      .update({ status: 'active', approved_by: profile.id })
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .select()
      .single()

    if (error) throw new ApiError(400, error.message)

    await writeAudit({
      orgId: profile.org_id, actorId: profile.id, action: 'override_approve',
      entityType: 'reconfirmation_override', entityId: params.id, before, after
    })

    return NextResponse.json(after)
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
