import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadOwnProject, assertStaff, loadProjectDetail } from '@/lib/projectService'
import { isValidIsoDate } from '@/lib/billing'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

async function loadItem(orgId: string, projectId: string, itemId: string) {
  if (!isUuid(itemId)) throw new ApiError(404, 'Item not found')
  const { data } = await supabaseService().from('project_checklist_items').select('id, status, template_item_id, na_reason').eq('id', itemId).eq('project_id', projectId).eq('org_id', orgId).is('archived_at', null).maybeSingle()
  if (!data) throw new ApiError(404, 'Item not found')
  return data
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    const project = await loadOwnProject(profile.org_id, params.id)
    const item = await loadItem(profile.org_id, project.id, params.itemId)
    const body = await req.json().catch(() => ({}))
    const patch: Record<string, unknown> = {}

    if ('status' in body) {
      if (!['open', 'done', 'na'].includes(body.status)) throw new ApiError(400, "status must be 'open', 'done' or 'na'")
      patch.status = body.status
      if (body.status === 'done') Object.assign(patch, { completed_at: new Date().toISOString(), completed_by: profile.id, na_reason: null })
      else if (body.status === 'open') Object.assign(patch, { completed_at: null, completed_by: null, na_reason: null })
      else {
        const why = typeof body.na_reason === 'string' ? body.na_reason.trim() : ''
        if (!why) throw new ApiError(400, 'Say why this step does not apply — skipping a step needs a reason on record')
        if (why.length > 500) throw new ApiError(400, 'The reason can be at most 500 characters')
        Object.assign(patch, { na_reason: why, completed_at: null, completed_by: null })
      }
    } else if ('na_reason' in body) {
      if (item.status !== 'na') throw new ApiError(400, 'Only a step marked N/A has a reason')
      const why = typeof body.na_reason === 'string' ? body.na_reason.trim() : ''
      if (!why) throw new ApiError(400, 'A reason is required'); patch.na_reason = why.slice(0, 500)
    }
    if ('owner_id' in body) patch.owner_id = body.owner_id === null ? null : await assertStaff(profile.org_id, body.owner_id)
    if ('due_date' in body) { if (body.due_date !== null && !isValidIsoDate(String(body.due_date))) throw new ApiError(400, 'due_date must be a valid date (YYYY-MM-DD)'); patch.due_date = body.due_date }
    if ('notes' in body) { if (body.notes !== null && (typeof body.notes !== 'string' || body.notes.length > 2000)) throw new ApiError(400, 'notes can be at most 2000 characters'); patch.notes = body.notes }
    if (Object.keys(patch).length === 0) throw new ApiError(400, 'Nothing to change')

    const { error } = await supabaseService().from('project_checklist_items').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', item.id)
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'checklist_item_updated', entityType: 'project', entityId: project.id, before: { status: item.status }, after: { item_id: item.id, ...patch } })
    return NextResponse.json(await loadProjectDetail(profile.org_id, project.id))
  } catch (err) { return errorResponse(err) }
}

/** Archive (not delete) — and only a CUSTOM item. A template step that doesn't apply is marked N/A with a reason instead. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    const project = await loadOwnProject(profile.org_id, params.id)
    const item = await loadItem(profile.org_id, project.id, params.itemId)
    if (item.template_item_id) throw new ApiError(400, 'A step from the template cannot be removed — mark it N/A with a reason instead')
    const { error } = await supabaseService().from('project_checklist_items').update({ archived_at: new Date().toISOString() }).eq('id', item.id)
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'checklist_item_archived', entityType: 'project', entityId: project.id, after: { item_id: item.id } })
    return NextResponse.json(await loadProjectDetail(profile.org_id, project.id))
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
