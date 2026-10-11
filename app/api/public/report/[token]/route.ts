import { NextRequest, NextResponse } from 'next/server'
import { writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { assembleReport } from '@/lib/reportService'
import { resolveLink, logView, notFound, isReportShape, PUBLIC_HEADERS } from '@/lib/reportPublic'
import type { Report } from '@/lib/reportBuilder'
import { isUuid } from '@/lib/ids'

/**
 * THE PUBLIC REPORT — no login. The link is looked up on every request; the report is built from the allow-list; if a forbidden
 * name would show, or the view cannot be logged, NOTHING is served. Every failure is the same 404.
 */
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const hit = await resolveLink(params.token); if (!hit) return notFound()
    const svc = supabaseService()
    const sid = req.nextUrl.searchParams.get('snapshot')
    let report: Report, snapshot: { id: string; taken_on: string; trigger: string } | null = null
    if (sid) {
      if (!isUuid(sid)) return notFound()
      const { data: s } = await svc.from('report_snapshots').select('id, trigger, period_date, content, leaks').eq('id', sid).eq('project_id', hit.project.id).eq('org_id', hit.link.org_id).maybeSingle()
      if (!s || (s.leaks ?? []).length > 0 || !isReportShape(s.content)) return notFound()
      report = s.content; snapshot = { id: s.id, taken_on: s.period_date, trigger: s.trigger }
    } else {
      const a = await assembleReport(hit.link.org_id, hit.project)
      if (a.leaks.length) { await writeAudit({ orgId: hit.link.org_id, actorId: null, action: 'report_blocked_forbidden_name', entityType: 'project', entityId: hit.project.id, after: { link_id: hit.link.id } }); return notFound() }
      report = a.report
    }
    if (!(await logView(hit, req, { kind: snapshot ? 'snapshot' : 'report', snapshotId: snapshot?.id }))) return notFound()
    const { data: snaps } = await svc.from('report_snapshots').select('id, period_date, trigger, leaks').eq('project_id', hit.project.id).order('taken_at', { ascending: false }).limit(60)
    return NextResponse.json({ report, snapshot, snapshots: (snaps ?? []).filter((x) => (x.leaks ?? []).length === 0).map((x) => ({ id: x.id, taken_on: x.period_date, trigger: x.trigger })), expires_at: hit.link.expires_at }, { headers: PUBLIC_HEADERS })
  } catch { return notFound() }
}
export const dynamic = 'force-dynamic'
