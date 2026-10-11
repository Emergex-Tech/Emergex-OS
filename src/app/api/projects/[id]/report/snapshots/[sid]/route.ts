import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { supabaseService } from '@/lib/supabaseServer'
import { loadReportProject } from '@/lib/reportAdmin'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

export async function GET(_req: NextRequest, { params }: { params: { id: string; sid: string } }) {
  try {
    const profile = await requireProfile()
    const project = await loadReportProject(profile.org_id, params.id)
    if (!isUuid(params.sid)) throw new ApiError(404, 'Snapshot not found')
    const { data } = await supabaseService().from('report_snapshots').select('id, trigger, period_date, taken_at, content, leaks').eq('id', params.sid).eq('project_id', project.id).maybeSingle()
    if (!data) throw new ApiError(404, 'Snapshot not found')
    return NextResponse.json(data)
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
