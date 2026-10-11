import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadCaseStudyContext } from '@/lib/projectService'
import { assembleDraft, deriveAnonymised, loadStudy, publicStudy, STUDY_COLUMNS, type ProjectRef } from '@/lib/caseStudyService'
import { findLeaks } from '@/lib/caseStudy'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

async function loadProject(orgId: string, id: string): Promise<ProjectRef & { status: string }> {
  if (!isUuid(id)) throw new ApiError(404, 'Project not found')
  const { data } = await supabaseService().from('projects').select('id, name, deal_id, status, closed_at').eq('id', id).eq('org_id', orgId).maybeSingle()
  if (!data) throw new ApiError(404, 'Project not found')
  return data
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const project = await loadProject(profile.org_id, params.id)
    const study = await loadStudy(profile.org_id, project.id)
    const leaks = study ? findLeaks(`${study.anonymised_title ?? ''}\n${study.anonymised_body ?? ''}`, study.hidden_names ?? []) : []
    return NextResponse.json({ case_study: publicStudy(study), leaks, can_draft: project.status === 'closed' })
  } catch (err) { return errorResponse(err) }
}

/** L23: draft from the records. Only for a CLOSED project. Redrafting overwrites the team's edits, so it needs {confirm_overwrite:true}. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    const project = await loadProject(profile.org_id, params.id)
    if (project.status !== 'closed') throw new ApiError(409, 'Close the project first — a case study is drafted from a finished project')
    const body = await req.json().catch(() => ({}))
    const existing = await loadStudy(profile.org_id, project.id)
    if (existing && body.confirm_overwrite !== true) throw new ApiError(409, 'There is already a case study for this project. Drafting again would overwrite the edits — confirm to continue.')
    const { ctx, draft, deliveryPct } = await assembleDraft(profile.org_id, project)
    const anon = deriveAnonymised(draft.title, draft.body, ctx, project.name)
    const row = {
      org_id: profile.org_id, project_id: project.id, status: 'draft', title: draft.title, body: draft.body, results: draft.results, delivery_pct: deliveryPct, brand_id: ctx.brandId, brand_name: ctx.brandName,
      category_keys: ctx.categoryKeys, markets: ctx.markets, property_names: ctx.propertyNames, hidden_names: anon.hidden_names, anonymised_title: anon.anonymised_title, anonymised_body: anon.anonymised_body,
      named_use_approved: false, approved_at: null, approved_by: null, drafted_by: profile.id, updated_by: profile.id, updated_at: new Date().toISOString(), drafted_at: new Date().toISOString()
    }
    const { data, error } = existing ? await supabaseService().from('case_studies').update(row).eq('id', existing.id).select(STUDY_COLUMNS).single() : await supabaseService().from('case_studies').insert(row).select(STUDY_COLUMNS).single()
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: existing ? 'case_study_redrafted' : 'case_study_drafted', entityType: 'project', entityId: project.id })
    return NextResponse.json({ case_study: data, leaks: anon.leaks }, { status: existing ? 200 : 201 })
  } catch (err) { return errorResponse(err) }
}

/** Edit the NAMED text. The anonymised copy is re-derived, and ANY edit takes an approved study back to draft (it must be approved again). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    const project = await loadProject(profile.org_id, params.id)
    const existing = await loadStudy(profile.org_id, project.id)
    if (!existing) throw new ApiError(404, 'There is no case study yet — draft one first')
    const b = await req.json().catch(() => ({}))
    const title = 'title' in b ? (typeof b.title === 'string' ? b.title.trim() : '') : existing.title
    const text = 'body' in b ? (typeof b.body === 'string' ? b.body.trim() : '') : existing.body
    if (!title || title.length > 200) throw new ApiError(400, 'A title of 1–200 characters is required')
    if (!text || text.length > 20000) throw new ApiError(400, 'The body must be 1–20,000 characters')
    if (title === existing.title && text === existing.body) throw new ApiError(400, 'Nothing to change')
    const ctx = await loadCaseStudyContext(profile.org_id, project)
    const anon = deriveAnonymised(title, text, ctx, project.name)
    const { data, error } = await supabaseService().from('case_studies').update({
      title, body: text, hidden_names: anon.hidden_names, anonymised_title: anon.anonymised_title, anonymised_body: anon.anonymised_body,
      status: 'draft', approved_at: null, approved_by: null, named_use_approved: false, updated_by: profile.id, updated_at: new Date().toISOString()
    }).eq('id', existing.id).select(STUDY_COLUMNS).single()
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'case_study_edited', entityType: 'project', entityId: project.id, after: { was_approved: existing.status === 'approved' } })
    return NextResponse.json({ case_study: data, leaks: anon.leaks, approval_withdrawn: existing.status === 'approved' })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
