import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadReportProject } from '@/lib/reportAdmin'
import { takeSnapshot } from '@/lib/reportService'
import { errorResponse } from '@/lib/apiError'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const project = await loadReportProject(profile.org_id, params.id)
    const { data } = await supabaseService().from('report_snapshots').select('id, trigger, period_date, taken_at, leaks, taker:profiles!report_snapshots_taken_by_fkey(full_name)').eq('project_id', project.id).order('taken_at', { ascending: false }).limit(200)
    return NextResponse.json((data ?? []).map((s) => ({ id: s.id, trigger: s.trigger, period_date: s.period_date, taken_at: s.taken_at, blocked: (s.leaks ?? []).length > 0, taken_by_name: (s.taker as unknown as { full_name: string } | null)?.full_name ?? null })))
  } catch (err) { return errorResponse(err) }
}

/** "Save a snapshot now": the report as it stands, frozen. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    const project = await loadReportProject(profile.org_id, params.id)
    const s = await takeSnapshot(profile.org_id, project, { trigger: 'manual', takenBy: profile.id })
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'report_snapshot_taken', entityType: 'project', entityId: project.id, after: { snapshot_id: s.id, trigger: 'manual' } })
    return NextResponse.json({ id: s.id, blocked: s.leaks.length > 0, leaks: s.leaks }, { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
