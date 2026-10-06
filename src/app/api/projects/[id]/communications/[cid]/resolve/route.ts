import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadOwnProject } from '@/lib/projectService'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/** Close an open request. The one change the log permits (the database refuses every other edit). Happens once. */
export async function POST(req: NextRequest, { params }: { params: { id: string; cid: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    const project = await loadOwnProject(profile.org_id, params.id)
    if (!isUuid(params.cid)) throw new ApiError(404, 'Entry not found')
    const body = await req.json().catch(() => ({}))
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) || null : null
    const svc = supabaseService()
    const { data, error } = await svc.from('project_communications')
      .update({ status: 'done', waiting_on: null, resolved_at: new Date().toISOString(), resolved_by: profile.id, resolution_note: note })
      .eq('id', params.cid).eq('project_id', project.id).eq('status', 'open').select('id').maybeSingle()
    if (error) throw new ApiError(400, error.message)
    if (!data) {
      const { data: exists } = await svc.from('project_communications').select('id').eq('id', params.cid).eq('project_id', project.id).maybeSingle()
      throw exists ? new ApiError(409, 'That request is already resolved') : new ApiError(404, 'Entry not found')
    }
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'project_request_resolved', entityType: 'project', entityId: project.id, after: { entry_id: params.cid } })
    return NextResponse.json({ ok: true })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
