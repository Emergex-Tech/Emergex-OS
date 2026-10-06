import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { GATE_RULES } from '@/lib/projects'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/** Edit or retire a template step. Retire (active:false) rather than delete: projects already created keep their copy either way. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'project.template.manage')
    if (!isUuid(params.id)) throw new ApiError(404, 'Not found')
    const b = await req.json().catch(() => ({}))
    const svc = supabaseService()
    const { data: cur } = await svc.from('checklist_template_items').select('id, template_key, phase_no').eq('id', params.id).maybeSingle()
    if (!cur) throw new ApiError(404, 'Not found')
    const patch: Record<string, unknown> = {}
    if ('title' in b) { const t = typeof b.title === 'string' ? b.title.trim() : ''; if (!t || t.length > 200) throw new ApiError(400, 'A title of 1–200 characters is required'); patch.title = t }
    if ('side' in b) { if (!['brand', 'team'].includes(b.side)) throw new ApiError(400, "side must be 'brand' or 'team'"); patch.side = b.side }
    if ('auto_rule' in b) { if (b.auto_rule !== null && !(GATE_RULES as readonly string[]).includes(b.auto_rule)) throw new ApiError(400, 'auto_rule is not valid'); patch.auto_rule = b.auto_rule }
    if ('position' in b) { if (!Number.isInteger(b.position)) throw new ApiError(400, 'position must be a whole number'); patch.position = b.position }
    if ('active' in b) patch.active = b.active === true
    if ('phase_no' in b) {   // move to a phase that ALREADY exists in this template (new phases are created by adding a step with a phase_name)
      const n = Number(b.phase_no)
      const { data: ph } = await svc.from('checklist_template_items').select('phase_name').eq('template_key', cur.template_key).eq('phase_no', n).limit(1)
      if (!ph?.length) throw new ApiError(400, 'That phase does not exist in this template yet')
      Object.assign(patch, { phase_no: n, phase_name: ph[0].phase_name })
    }
    if (Object.keys(patch).length === 0) throw new ApiError(400, 'Nothing to change')
    const { data, error } = await svc.from('checklist_template_items').update(patch).eq('id', params.id).select('*').single()
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'checklist_template_item_updated', entityType: 'checklist_template', entityId: params.id, after: patch })
    return NextResponse.json(data)
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
