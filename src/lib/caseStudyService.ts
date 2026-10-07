import { supabaseService } from './supabaseServer'
import { loadDeliverablesByDeal, loadMetricSummary, loadCaseStudyContext } from './projectService'
import { projectDelivery, type DeliveryStatus } from './delivery'
import { draftCaseStudy, hiddenNames, anonymise, findLeaks } from './caseStudy'

export interface ProjectRef { id: string; name: string; deal_id: string; closed_at: string | null }
type Ctx = Awaited<ReturnType<typeof loadCaseStudyContext>>

/** The anonymised version is ALWAYS derived from the named one — never typed — so editing the named text can't leave a stale or leaky copy. */
export function deriveAnonymised(title: string, body: string, ctx: Ctx, projectName: string) {
  const hidden = hiddenNames({ brand: ctx.brandNames, projectName, partners: ctx.partners })
  const anonymised_title = anonymise(title, hidden), anonymised_body = anonymise(body, hidden)
  return { anonymised_title, anonymised_body, hidden_names: hidden.all, leaks: findLeaks(`${anonymised_title}\n${anonymised_body}`, hidden.all) }
}

/** Builds the draft from the project's records. Every figure is copied from them. */
export async function assembleDraft(orgId: string, project: ProjectRef) {
  const ctx = await loadCaseStudyContext(orgId, project)
  const dels = await loadDeliverablesByDeal(orgId, [project.deal_id])
  const rows = (dels.byDeal.get(project.deal_id) ?? []) as { description: string; status: string; planned_quantity: number; delivered_quantity: number; unit: string | null; pct: number; proof_count: number }[]
  const metrics = await loadMetricSummary(orgId, project.id, ctx.categoryKeys)
  const delivery = projectDelivery(rows.map((d) => ({ status: d.status as DeliveryStatus, planned: Number(d.planned_quantity), delivered: Number(d.delivered_quantity) })))
  const draft = draftCaseStudy({
    projectName: project.name, brandName: ctx.brandName, categories: ctx.categoryLabels, markets: ctx.markets, propertyNames: ctx.propertyNames, deliveryPct: delivery.pct, closedOn: project.closed_at ? project.closed_at.slice(0, 10) : null,
    deliverables: rows.map((d) => ({ description: d.description, status: d.status, planned: Number(d.planned_quantity), delivered: Number(d.delivered_quantity), unit: d.unit, pct: d.pct, proof_count: d.proof_count })),
    metrics: metrics.map((m) => ({ label: m.label, value: m.value, unit: m.unit, aggregation: m.aggregation, subjects: m.subjects, as_of: m.as_of }))
  })
  return { ctx, draft, deliveryPct: delivery.pct }
}

/** Columns safe to return — never hidden_names. */
export const STUDY_COLUMNS = 'id, project_id, status, title, body, results, delivery_pct, brand_name, category_keys, markets, property_names, anonymised_title, anonymised_body, named_use_approved, drafted_at, updated_at, approved_at'
export async function loadStudy(orgId: string, projectId: string) {
  const { data } = await supabaseService().from('case_studies').select(`${STUDY_COLUMNS}, hidden_names`).eq('org_id', orgId).eq('project_id', projectId).maybeSingle()
  return data
}
export const publicStudy = (s: Record<string, unknown> | null) => { if (!s) return null; const { hidden_names, ...rest } = s; void hidden_names; return rest }
