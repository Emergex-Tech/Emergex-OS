import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '@/lib/supabaseServer'
import { assembleReport } from '@/lib/reportService'
import { renderReportPdf } from '@/lib/reportPdf'
import { resolveLink, logView, notFound, isReportShape, PUBLIC_HEADERS } from '@/lib/reportPublic'
import type { Report } from '@/lib/reportBuilder'
import { safeFilePart } from '@/lib/naming'
import { isUuid } from '@/lib/ids'

export const runtime = 'nodejs'
/** The PDF of the current report or of a saved snapshot (?snapshot=). Same rules as the page: any forbidden name or unlogged view = nothing. */
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const hit = await resolveLink(params.token); if (!hit) return notFound()
    const sid = req.nextUrl.searchParams.get('snapshot')
    let report: Report, day: string
    if (sid) {
      if (!isUuid(sid)) return notFound()
      const { data: s } = await supabaseService().from('report_snapshots').select('content, period_date, leaks').eq('id', sid).eq('project_id', hit.project.id).eq('org_id', hit.link.org_id).maybeSingle()
      if (!s || (s.leaks ?? []).length > 0 || !isReportShape(s.content)) return notFound(); report = s.content; day = s.period_date
    } else { const a = await assembleReport(hit.link.org_id, hit.project); if (a.leaks.length) return notFound(); report = a.report; day = a.report.as_of }
    if (!(await logView(hit, req, { kind: 'pdf', snapshotId: sid ?? undefined }))) return notFound()
    const bytes = await renderReportPdf(report)
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers: { ...PUBLIC_HEADERS, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${safeFilePart(report.title) || 'report'}-${day}.pdf"` } })
  } catch { return notFound() }
}
export const dynamic = 'force-dynamic'
