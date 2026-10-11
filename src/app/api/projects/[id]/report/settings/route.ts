import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadReportProject } from '@/lib/reportAdmin'
import { loadSettings, routeAgent } from '@/lib/reportService'
import { CADENCES } from '@/lib/reportCadence'
import { errorResponse } from '@/lib/apiError'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const project = await loadReportProject(profile.org_id, params.id)
    return NextResponse.json({ settings: await loadSettings(profile.org_id, project.id), route_agent: await routeAgent(profile.org_id, project.deal_id) })
  } catch (err) { return errorResponse(err) }
}

/** Branding and cadence face the brand, so Manager/CEO set them. Agent or co-branded is only possible when the deal really came through that agent (D17: the agent's NAME only). */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'project.manage')
    const project = await loadReportProject(profile.org_id, params.id)
    const b = await req.json().catch(() => ({}))
    const cur = await loadSettings(profile.org_id, project.id)
    const branding = b.branding ?? cur.branding, cadence = b.cadence ?? cur.cadence
    if (!['emergex', 'agent', 'co_branded'].includes(branding)) throw new ApiError(400, "branding must be 'emergex', 'agent' or 'co_branded'")
    if (!(CADENCES as readonly string[]).includes(cadence)) throw new ApiError(400, `cadence must be one of: ${CADENCES.join(', ')}`)
    let title: string | null = 'title' in b ? (b.title === null || b.title === '' ? null : typeof b.title === 'string' ? b.title.trim() : '') : cur.title
    if (title !== null && (title.length < 1 || title.length > 120)) throw new ApiError(400, 'The title must be 1–120 characters (or empty to use the project name)')
    let agentId: string | null = null
    if (branding !== 'emergex') {
      const ra = await routeAgent(profile.org_id, project.deal_id)
      if (!ra) throw new ApiError(400, 'This deal did not come through an agent, so only EmergeX branding is available')
      agentId = ra.agent_id
    }
    const { error } = await supabaseService().from('project_report_settings').upsert({ project_id: project.id, org_id: profile.org_id, branding, cadence, title, agent_id: agentId, updated_by: profile.id, updated_at: new Date().toISOString() }, { onConflict: 'project_id' })
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'report_settings_changed', entityType: 'project', entityId: project.id, after: { branding, cadence, title } })
    return NextResponse.json({ settings: await loadSettings(profile.org_id, project.id) })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
