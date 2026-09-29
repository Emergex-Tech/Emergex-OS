import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'competitor.manage')
    const svc = supabaseService()
    const { data: before } = await svc.from('competitor_links').select('*').eq('id', params.id).eq('org_id', profile.org_id).single()
    if (!before) throw new ApiError(404, 'Competitor link not found')
    const { error } = await svc.from('competitor_links').delete().eq('id', params.id).eq('org_id', profile.org_id)
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'delete', entityType: 'competitor_link', entityId: params.id, before })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
