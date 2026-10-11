import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/** Take an approved case study out of the repository (back to draft). Also withdraws any named-use approval. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'project.manage')
    if (!isUuid(params.id)) throw new ApiError(404, 'Project not found')
    const { data, error } = await supabaseService().from('case_studies').update({ status: 'draft', approved_at: null, approved_by: null, named_use_approved: false, updated_by: profile.id, updated_at: new Date().toISOString() })
      .eq('project_id', params.id).eq('org_id', profile.org_id).eq('status', 'approved').select('id').maybeSingle()
    if (error) throw new ApiError(400, error.message)
    if (!data) throw new ApiError(409, 'There is no approved case study for this project')
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'case_study_withdrawn', entityType: 'project', entityId: params.id })
    return NextResponse.json({ withdrawn: true })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
