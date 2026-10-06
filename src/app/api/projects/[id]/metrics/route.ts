import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadOwnProject, projectCategories, loadMetricDefs } from '@/lib/projectService'
import { summariseMetrics, validateMetricValue, type MetricEntry } from '@/lib/metrics'
import { isValidIsoDate } from '@/lib/billing'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

const SELECT = 'id, deliverable_id, category_key, metric_key, value, recorded_on, source, source_ref, created_at, voided_at, void_reason, recorder:profiles!project_metrics_recorded_by_fkey(full_name), deliverable:deliverables(description)'

/** The metric sets that apply to this project, the entries recorded, and the headline figures (latest reading per deliverable; counts summed, rates averaged). */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const project = await loadOwnProject(profile.org_id, params.id)
    const cats = await projectCategories(profile.org_id, project.deal_id)
    const defs = await loadMetricDefs(cats)
    let q = supabaseService().from('project_metrics').select(SELECT).eq('org_id', profile.org_id).eq('project_id', project.id).order('recorded_on', { ascending: false }).order('created_at', { ascending: false }).limit(500)
    if (req.nextUrl.searchParams.get('include_voided') !== '1') q = q.is('voided_at', null)
    const { data, error } = await q
    if (error) throw new ApiError(500, error.message)
    const entries = (data ?? []).map((e) => ({ ...e, value: Number(e.value), recorded_by_name: (e.recorder as unknown as { full_name: string } | null)?.full_name ?? null, deliverable_name: (e.deliverable as unknown as { description: string } | null)?.description ?? null, recorder: undefined, deliverable: undefined }))
    return NextResponse.json({ categories: cats, definitions: defs, entries, summary: summariseMetrics(entries.filter((e) => !e.voided_at) as unknown as MetricEntry[], defs) })
  } catch (err) { return errorResponse(err) }
}

/** L14: record a reading. category_key may be omitted when the metric key is unambiguous for this project. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.create')
    const project = await loadOwnProject(profile.org_id, params.id)
    const b = await req.json().catch(() => ({}))
    const cats = await projectCategories(profile.org_id, project.deal_id)
    const defs = (await loadMetricDefs(cats)).filter((d) => d.active)
    const matches = defs.filter((d) => d.key === b.metric_key && (b.category_key == null || d.category_key === b.category_key))
    if (matches.length === 0) throw new ApiError(400, 'That is not a metric for this project\'s categories')
    if (matches.length > 1) throw new ApiError(400, `"${b.metric_key}" exists in more than one of this project's categories — say which with category_key (${matches.map((m) => m.category_key).join(', ')})`)
    const def = matches[0]
    const v = validateMetricValue(def, b.value); if (!v.ok) throw new ApiError(400, v.reason)
    const today = new Date().toISOString().slice(0, 10), tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    const on = b.recorded_on ?? today
    if (typeof on !== 'string' || !isValidIsoDate(on)) throw new ApiError(400, 'recorded_on must be a valid date (YYYY-MM-DD)')
    if (on > tomorrow) throw new ApiError(400, 'recorded_on cannot be in the future')
    const source = typeof b.source === 'string' ? b.source.trim() : ''
    if (!source || source.length > 200) throw new ApiError(400, 'Say where the figure came from (1–200 characters)')
    if (b.source_ref != null && (typeof b.source_ref !== 'string' || b.source_ref.length > 500)) throw new ApiError(400, 'source_ref can be at most 500 characters')
    const svc = supabaseService()
    if (b.deliverable_id != null) {
      if (!isUuid(b.deliverable_id)) throw new ApiError(400, 'deliverable_id is not valid')
      const { data: c } = await svc.from('contracts').select('id').eq('deal_id', project.deal_id).maybeSingle()
      const { data: d } = c ? await svc.from('deliverables').select('id').eq('id', b.deliverable_id).eq('contract_id', c.id).maybeSingle() : { data: null }
      if (!d) throw new ApiError(400, 'That deliverable is not on this project')
    }
    const { data, error } = await svc.from('project_metrics').insert({
      org_id: profile.org_id, project_id: project.id, deliverable_id: b.deliverable_id ?? null, category_key: def.category_key, metric_key: def.key, value: v.value,
      recorded_on: on, source, source_ref: b.source_ref ?? null, recorded_by: profile.id
    }).select(SELECT).single()
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'project_metric_recorded', entityType: 'project', entityId: project.id, after: { entry_id: data.id, metric: def.key, value: v.value } })
    // Same shape as the list endpoint, so the caller can show the new entry without re-fetching.
    return NextResponse.json({ ...data, value: Number(data.value), recorded_by_name: (data.recorder as unknown as { full_name: string } | null)?.full_name ?? null, deliverable_name: (data.deliverable as unknown as { description: string } | null)?.description ?? null, recorder: undefined, deliverable: undefined }, { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
