import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadCaseStudyContext } from '@/lib/projectService'
import { deriveAnonymised, loadStudy, STUDY_COLUMNS } from '@/lib/caseStudyService'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/**
 * Approve for the repository. Manager/CEO. Refused while the anonymised version still contains the brand or a partner
 * (checked here with a readable list, and again by the database as the final guard). D16: anonymised by default —
 * the NAMED version is only usable in a pitch if you say the brand agreed ({named_use_approved:true}).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'project.manage')
    if (!isUuid(params.id)) throw new ApiError(404, 'Project not found')
    const svc = supabaseService()
    const { data: project } = await svc.from('projects').select('id, name, deal_id').eq('id', params.id).eq('org_id', profile.org_id).maybeSingle()
    if (!project) throw new ApiError(404, 'Project not found')
    const study = await loadStudy(profile.org_id, project.id)
    if (!study) throw new ApiError(404, 'There is no case study to approve')
    if (study.status === 'approved') throw new ApiError(409, 'This case study is already approved')
    const b = await req.json().catch(() => ({}))
    const ctx = await loadCaseStudyContext(profile.org_id, project)
    const anon = deriveAnonymised(study.title, study.body, ctx, project.name)
    if (anon.leaks.length) return NextResponse.json({ error: `The anonymised version still contains: ${anon.leaks.join(', ')}. Edit the text so those names don't appear, then approve again.`, leaks: anon.leaks }, { status: 409 })
    const { data, error } = await svc.from('case_studies').update({
      status: 'approved', approved_at: new Date().toISOString(), approved_by: profile.id, named_use_approved: b.named_use_approved === true,
      hidden_names: anon.hidden_names, anonymised_title: anon.anonymised_title, anonymised_body: anon.anonymised_body, updated_by: profile.id, updated_at: new Date().toISOString()
    }).eq('id', study.id).eq('status', 'draft').select(STUDY_COLUMNS).maybeSingle()
    if (error) throw new ApiError(error.message.includes('still contains') ? 409 : 400, error.message)
    if (!data) throw new ApiError(409, 'This case study changed while you were approving it — review it and try again')
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'case_study_approved', entityType: 'project', entityId: project.id, after: { named_use_approved: b.named_use_approved === true } })
    return NextResponse.json({ case_study: data })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
