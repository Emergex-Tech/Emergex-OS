import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

/** Assign a brand to a brand group (or clear it with null). This is what the same-group conflict check (A23) keys on. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    const body = await req.json()
    if (!('brand_group_id' in body)) throw new ApiError(400, 'brand_group_id is required (use null to clear)')

    const svc = supabaseService()
    if (body.brand_group_id) {
      const { data: g } = await svc.from('brand_groups').select('id').eq('id', body.brand_group_id).eq('org_id', profile.org_id).maybeSingle()
      if (!g) throw new ApiError(400, 'That brand group does not exist')
    }
    const { data: before } = await svc.from('brands').select('id, brand_group_id').eq('id', params.id).eq('org_id', profile.org_id).single()
    if (!before) throw new ApiError(404, 'Brand not found')

    const { data: after, error } = await svc.from('brands').update({ brand_group_id: body.brand_group_id ?? null })
      .eq('id', params.id).eq('org_id', profile.org_id).select('id, brand_group_id').single()
    if (error) throw new ApiError(400, error.message)

    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'update', entityType: 'brand', entityId: params.id, before, after })
    return NextResponse.json(after)
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
