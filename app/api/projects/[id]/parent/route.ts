import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/** L2: make this project an upsell of an ORIGINAL project (or detach it with null). The database refuses loops and chains. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'project.manage')
    if (!isUuid(params.id)) throw new ApiError(404, 'Project not found')
    const body = await req.json().catch(() => ({}))
    const parentId = body.parent_project_id ?? null
    if (parentId !== null && !isUuid(parentId)) throw new ApiError(400, 'parent_project_id is not valid')
    const svc = supabaseService()
    const { data: me } = await svc.from('projects').select('id, deal_id').eq('id', params.id).eq('org_id', profile.org_id).maybeSingle()
    if (!me) throw new ApiError(404, 'Project not found')
    let parentDeal: string | null = null
    if (parentId) {
      const { data: par } = await svc.from('projects').select('id, deal_id').eq('id', parentId).eq('org_id', profile.org_id).maybeSingle()
      if (!par) throw new ApiError(404, 'The parent project was not found')
      parentDeal = par.deal_id
    }
    const { error } = await svc.from('projects').update({ parent_project_id: parentId, updated_at: new Date().toISOString() }).eq('id', params.id)
    if (error) throw new ApiError(400, error.message) // the trigger's own message: "…itself an upsell", "…already has upsells", etc.
    await svc.from('deals').update({ parent_deal_id: parentDeal }).eq('id', me.deal_id)   // keep the deal-level link (reserved since Stage 1) in step
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: parentId ? 'project_linked_as_upsell' : 'project_unlinked', entityType: 'project', entityId: params.id, after: { parent_project_id: parentId } })
    return NextResponse.json({ ok: true })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
