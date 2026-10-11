import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadReportProject } from '@/lib/reportAdmin'
import { assembleReport } from '@/lib/reportService'
import { renderReportPdf } from '@/lib/reportPdf'
import { safeFilePart } from '@/lib/naming'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

export const runtime = 'nodejs'
/** Staff PDF of the report as it stands now, or of any saved snapshot (?snapshot=<id>). */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const project = await loadReportProject(profile.org_id, params.id)
    const sid = req.nextUrl.searchParams.get('snapshot')
    let report, day
    if (sid) {
      if (!isUuid(sid)) throw new ApiError(404, 'Snapshot not found')
      const { data } = await supabaseService().from('report_snapshots').select('content, period_date').eq('id', sid).eq('project_id', project.id).maybeSingle()
      if (!data) throw new ApiError(404, 'Snapshot not found'); report = data.content; day = data.period_date
    } else { report = (await assembleReport(profile.org_id, project)).report; day = report.as_of }
    const bytes = await renderReportPdf(report)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'report_pdf_exported', entityType: 'project', entityId: project.id, after: { snapshot_id: sid } })
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${safeFilePart(report.title)}-report-${day}.pdf"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
