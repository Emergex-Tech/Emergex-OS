import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { supabaseService } from '@/lib/supabaseServer'
import { loadReportProject } from '@/lib/reportAdmin'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/** The view log for one link: when, what kind, and a per-link hash of the viewer (never the address). */
export async function GET(_req: NextRequest, { params }: { params: { id: string; linkId: string } }) {
  try {
    const profile = await requireProfile()
    const project = await loadReportProject(profile.org_id, params.id)
    if (!isUuid(params.linkId)) throw new ApiError(404, 'Link not found')
    const svc = supabaseService()
    const { data: link } = await svc.from('report_links').select('id').eq('id', params.linkId).eq('project_id', project.id).maybeSingle()
    if (!link) throw new ApiError(404, 'Link not found')
    const { data } = await svc.from('report_views').select('id, kind, viewed_at, snapshot_id, proof_id, ip_hash, user_agent').eq('link_id', link.id).order('viewed_at', { ascending: false }).limit(200)
    return NextResponse.json(data ?? [])
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
