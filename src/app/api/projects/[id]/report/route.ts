import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { loadReportProject } from '@/lib/reportAdmin'
import { assembleReport } from '@/lib/reportService'
import { errorResponse } from '@/lib/apiError'

/** "Preview as the brand": exactly what a link would show right now, plus whether it is safe to share. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const project = await loadReportProject(profile.org_id, params.id)
    const { report, leaks, settings } = await assembleReport(profile.org_id, project)
    return NextResponse.json({ report, settings, leaks, safe_to_share: leaks.length === 0, links_released: process.env.REPORT_LINKS_ENABLED === '1' })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
