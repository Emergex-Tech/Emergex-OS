import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { ensureProject, loadFactsBulk, loadDeliverablesByDeal } from '@/lib/projectService'
import { effectiveStatus, gateStatus, phaseProgress, type GateRule, type ItemStatus } from '@/lib/projects'
import { projectDelivery } from '@/lib/delivery'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

export async function GET() {
  try {
    const profile = await requireProfile()
    const svc = supabaseService()
    const { data: projects, error } = await svc.from('projects')
      .select('id, name, status, template_key, deal_id, parent_project_id, created_at, owner:profiles!projects_owner_id_fkey(full_name), deals(proposals(brands(name)))')
      .eq('org_id', profile.org_id).order('created_at', { ascending: false }).limit(500)
    if (error) throw new ApiError(500, error.message)
    const rows = projects ?? []
    const ids = rows.map((r) => r.id), dealIds = rows.map((r) => r.deal_id)
    const [facts, dels, items, open] = await Promise.all([
      loadFactsBulk(profile.org_id, dealIds), loadDeliverablesByDeal(profile.org_id, dealIds),
      ids.length ? svc.from('project_checklist_items').select('project_id, phase_no, phase_name, side, status, auto_rule').in('project_id', ids).is('archived_at', null) : Promise.resolve({ data: [] }),
      ids.length ? svc.from('project_communications').select('project_id, waiting_on').in('project_id', ids).eq('status', 'open') : Promise.resolve({ data: [] })
    ])
    return NextResponse.json(rows.map((r) => {
      const mine = ((items.data ?? []) as { project_id: string; phase_no: number; phase_name: string; side: 'brand' | 'team'; status: ItemStatus; auto_rule: GateRule | null }[]).filter((i) => i.project_id === r.id)
      const eff = mine.map((i) => ({ ...i, status: effectiveStatus(i, facts.get(r.deal_id)!) }))
      const prog = phaseProgress(eff); const na = eff.filter((i) => i.status === 'na').length
      const reqs = ((open.data ?? []) as { project_id: string; waiting_on: string }[]).filter((o) => o.project_id === r.id)
      return {
        id: r.id, name: r.name, status: r.status, template_key: r.template_key, parent_project_id: r.parent_project_id, created_at: r.created_at,
        brand_name: ((r.deals as unknown as { proposals: { brands: { name: string } | null } | null } | null)?.proposals?.brands?.name) ?? '',
        owner_name: (r.owner as unknown as { full_name: string } | null)?.full_name ?? null,
        checklist_pct: eff.length - na === 0 ? null : Math.round((eff.filter((i) => i.status === 'done').length / (eff.length - na)) * 100),
        gate: gateStatus(prog.find((p) => p.phase_no === 1)).overall,
        delivery: projectDelivery((dels.byDeal.get(r.deal_id) ?? []).map((d) => ({ status: d.status as never, planned: Number(d.planned_quantity), delivered: Number(d.delivered_quantity) }))),
        waiting_on_us: reqs.filter((q) => q.waiting_on === 'us').length, waiting_on_them: reqs.filter((q) => q.waiting_on === 'them').length
      }
    }))
  } catch (err) { return errorResponse(err) }
}

/** Manually create the project for one won deal (the normal path is automatic, on Won). */
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'project.manage')
    const body = await req.json().catch(() => ({}))
    if (!isUuid(body.deal_id)) throw new ApiError(400, 'deal_id is required')
    const r = await ensureProject(profile.org_id, body.deal_id, profile.id)
    return NextResponse.json(r, { status: r.created ? 201 : 200 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
