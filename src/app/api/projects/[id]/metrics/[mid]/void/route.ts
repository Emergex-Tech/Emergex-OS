import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadOwnProject } from '@/lib/projectService'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/** An entry cannot be edited or deleted. A wrong one is VOIDED (with a reason, once) and the right figure recorded as a new entry. */
export async function POST(req: NextRequest, { params }: { params: { id: string; mid: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    const project = await loadOwnProject(profile.org_id, params.id)
    if (!isUuid(params.mid)) throw new ApiError(404, 'Entry not found')
    const b = await req.json().catch(() => ({}))
    const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
    if (!reason) throw new ApiError(400, 'Say why this entry is being voided')
    if (reason.length > 500) throw new ApiError(400, 'The reason can be at most 500 characters')
    const svc = supabaseService()
    const { data, error } = await svc.from('project_metrics').update({ voided_at: new Date().toISOString(), voided_by: profile.id, void_reason: reason }).eq('id', params.mid).eq('project_id', project.id).is('voided_at', null).select('id').maybeSingle()
    if (error) throw new ApiError(400, error.message)
    if (!data) {
      const { data: ex } = await svc.from('project_metrics').select('id').eq('id', params.mid).eq('project_id', project.id).maybeSingle()
      throw ex ? new ApiError(409, 'That entry is already voided') : new ApiError(404, 'Entry not found')
    }
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'project_metric_voided', entityType: 'project', entityId: project.id, after: { entry_id: params.mid, reason } })
    return NextResponse.json({ ok: true })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
