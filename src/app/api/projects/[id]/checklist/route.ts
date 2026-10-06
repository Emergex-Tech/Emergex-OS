import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadOwnProject, assertStaff, loadProjectDetail } from '@/lib/projectService'
import { isValidIsoDate } from '@/lib/billing'
import { errorResponse } from '@/lib/apiError'

/** L5: add a custom item to THIS project (the template is untouched). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    const project = await loadOwnProject(profile.org_id, params.id)
    const body = await req.json().catch(() => ({}))
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title || title.length > 200) throw new ApiError(400, 'A title of 1–200 characters is required')
    if (!['brand', 'team'].includes(body.side)) throw new ApiError(400, "side must be 'brand' or 'team'")
    const phaseNo = Number(body.phase_no)
    if (!Number.isInteger(phaseNo) || phaseNo < 1 || phaseNo > 9) throw new ApiError(400, 'phase_no must be a whole number from 1 to 9')
    if (body.due_date != null && !isValidIsoDate(String(body.due_date))) throw new ApiError(400, 'due_date must be a valid date (YYYY-MM-DD)')
    const ownerId = body.owner_id != null ? await assertStaff(profile.org_id, body.owner_id) : null
    const svc = supabaseService()
    const { data: same } = await svc.from('project_checklist_items').select('phase_name, position').eq('project_id', project.id).eq('phase_no', phaseNo).order('position', { ascending: false })
    const phaseName = same?.[0]?.phase_name ?? (typeof body.phase_name === 'string' && body.phase_name.trim() ? body.phase_name.trim().slice(0, 80) : 'Custom')
    const { data, error } = await svc.from('project_checklist_items').insert({
      org_id: profile.org_id, project_id: project.id, phase_no: phaseNo, phase_name: phaseName, side: body.side, title, due_date: body.due_date ?? null, owner_id: ownerId, position: (same?.[0]?.position ?? 0) + 10
    }).select('id').single()
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'checklist_item_added', entityType: 'project', entityId: project.id, after: { item_id: data.id, title } })
    return NextResponse.json(await loadProjectDetail(profile.org_id, project.id), { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
