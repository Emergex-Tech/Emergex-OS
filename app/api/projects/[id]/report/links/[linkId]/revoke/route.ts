import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadReportProject } from '@/lib/reportAdmin'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/** Takes effect on the very next request: the public routes look the link up every time. Cannot be undone — create a new link instead. */
export async function POST(_req: NextRequest, { params }: { params: { id: string; linkId: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'project.manage')
    const project = await loadReportProject(profile.org_id, params.id)
    if (!isUuid(params.linkId)) throw new ApiError(404, 'Link not found')
    const svc = supabaseService()
    const { data, error } = await svc.from('report_links').update({ revoked_at: new Date().toISOString(), revoked_by: profile.id }).eq('id', params.linkId).eq('project_id', project.id).is('revoked_at', null).select('id').maybeSingle()
    if (error) throw new ApiError(400, error.message)
    if (!data) { const { data: ex } = await svc.from('report_links').select('id').eq('id', params.linkId).eq('project_id', project.id).maybeSingle(); throw ex ? new ApiError(409, 'That link is already revoked') : new ApiError(404, 'Link not found') }
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'report_link_revoked', entityType: 'project', entityId: project.id, after: { link_id: params.linkId } })
    return NextResponse.json({ revoked: true })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
