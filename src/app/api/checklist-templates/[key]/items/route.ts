import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { GATE_RULES } from '@/lib/projects'
import { errorResponse } from '@/lib/apiError'

/** Add a step to a template. It applies to projects created FROM NOW ON — live projects keep the copy they were given. */
export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'project.template.manage')
    const b = await req.json().catch(() => ({}))
    const svc = supabaseService()
    const { data: t } = await svc.from('checklist_templates').select('key').eq('key', params.key).maybeSingle()
    if (!t) throw new ApiError(404, 'Template not found')
    const title = typeof b.title === 'string' ? b.title.trim() : ''
    if (!title || title.length > 200) throw new ApiError(400, 'A title of 1–200 characters is required')
    if (!['brand', 'team'].includes(b.side)) throw new ApiError(400, "side must be 'brand' or 'team'")
    const phaseNo = Number(b.phase_no); if (!Number.isInteger(phaseNo) || phaseNo < 1 || phaseNo > 9) throw new ApiError(400, 'phase_no must be a whole number from 1 to 9')
    if (b.auto_rule != null && !(GATE_RULES as readonly string[]).includes(b.auto_rule)) throw new ApiError(400, `auto_rule must be one of ${GATE_RULES.join(', ')}`)
    const { data: same } = await svc.from('checklist_template_items').select('phase_name, position').eq('template_key', params.key).eq('phase_no', phaseNo).order('position', { ascending: false })
    const phaseName = same?.[0]?.phase_name ?? (typeof b.phase_name === 'string' && b.phase_name.trim() ? b.phase_name.trim().slice(0, 80) : null)
    if (!phaseName) throw new ApiError(400, 'That is a new phase — give it a phase_name')
    const { data, error } = await svc.from('checklist_template_items').insert({ template_key: params.key, phase_no: phaseNo, phase_name: phaseName, side: b.side, title, auto_rule: b.auto_rule ?? null, position: Number.isInteger(b.position) ? b.position : (same?.[0]?.position ?? 0) + 10 }).select('*').single()
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'checklist_template_item_added', entityType: 'checklist_template', entityId: data.id, after: { template: params.key, title } })
    return NextResponse.json(data, { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
