import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadOwnProject, loadProjectDetail } from '@/lib/projectService'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/** Archive a party (kept for the history of the log; it just stops being listed as current). */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; partyId: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    const project = await loadOwnProject(profile.org_id, params.id)
    if (!isUuid(params.partyId)) throw new ApiError(404, 'Party not found')
    const { data, error } = await supabaseService().from('project_parties').update({ archived_at: new Date().toISOString() }).eq('id', params.partyId).eq('project_id', project.id).is('archived_at', null).select('id').maybeSingle()
    if (error) throw new ApiError(400, error.message)
    if (!data) throw new ApiError(404, 'Party not found')
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'project_party_archived', entityType: 'project', entityId: project.id, after: { party_id: params.partyId } })
    return NextResponse.json(await loadProjectDetail(profile.org_id, project.id))
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
