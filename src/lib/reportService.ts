import crypto from 'node:crypto'
import { supabaseService } from './supabaseServer'
import { projectCategories, loadMetricDefs } from './projectService'
import { buildReport, reportForbiddenNames, reportLeaks, type Report, type Branding, type RawDeliverable, type RawProof, type RawEntry } from './reportBuilder'
import type { Cadence } from './reportCadence'

export interface ReportProject { id: string; name: string; deal_id: string; status: string }
export interface ReportSettings { branding: Branding; cadence: Cadence; title: string | null; agent_id: string | null }
export const DEFAULT_SETTINGS: ReportSettings = { branding: 'emergex', cadence: 'manual', title: null, agent_id: null }
export const utcToday = (now = new Date()) => now.toISOString().slice(0, 10)

export async function loadSettings(orgId: string, projectId: string): Promise<ReportSettings> {
  const { data } = await supabaseService().from('project_report_settings').select('branding, cadence, title, agent_id').eq('org_id', orgId).eq('project_id', projectId).maybeSingle()
  return (data as ReportSettings | null) ?? DEFAULT_SETTINGS
}
/** The agent the BRAND dealt through (the proposal's route) — the only agent whose name an agent-branded report may carry. */
export async function routeAgent(orgId: string, dealId: string): Promise<{ agent_id: string; agent_name: string } | null> {
  const svc = supabaseService()
  const { data: deal } = await svc.from('deals').select('proposal_id').eq('id', dealId).eq('org_id', orgId).maybeSingle()
  if (!deal?.proposal_id) return null
  const { data: prop } = await svc.from('proposals').select('routes(route_type, agent_id, agents(name))').eq('id', deal.proposal_id).maybeSingle()
  const r = prop?.routes as unknown as { route_type: string; agent_id: string | null; agents: { name: string } | null } | null
  return r && r.route_type === 'via_agent' && r.agent_id && r.agents ? { agent_id: r.agent_id, agent_name: r.agents.name } : null
}

/** Builds the CURRENT brand-facing report for a project, plus the fail-closed leak check. Explicit column lists throughout. */
export async function assembleReport(orgId: string, project: ReportProject, now = new Date()): Promise<{ report: Report; leaks: string[]; settings: ReportSettings }> {
  const svc = supabaseService()
  const settings = await loadSettings(orgId, project.id)
  const { data: deal } = await svc.from('deals').select('proposal_id').eq('id', project.deal_id).eq('org_id', orgId).maybeSingle()
  const { data: prop } = deal ? await svc.from('proposals').select('brands(name)').eq('id', deal.proposal_id).maybeSingle() : { data: null }
  const brandName = (prop?.brands as unknown as { name: string } | null)?.name ?? 'Brand'
  const agentName = settings.branding !== 'emergex' && settings.agent_id ? ((await svc.from('agents').select('name').eq('id', settings.agent_id).eq('org_id', orgId).maybeSingle()).data?.name ?? null) : null

  const { data: contract } = await svc.from('contracts').select('id').eq('deal_id', project.deal_id).eq('org_id', orgId).maybeSingle()
  const { data: dels } = contract ? await svc.from('deliverables').select('id, description, status, planned_quantity, delivered_quantity, unit, due_date').eq('contract_id', contract.id).order('created_at') : { data: [] }
  const delIds = (dels ?? []).map((d) => d.id as string)
  const { data: proofs } = delIds.length ? await svc.from('deliverable_proofs').select('id, deliverable_id, name, kind, created_at, report_visible, archived_at, url').in('deliverable_id', delIds).order('created_at') : { data: [] }
  const categories = await projectCategories(orgId, project.deal_id)
  const defs = await loadMetricDefs(categories)
  const { data: entries } = await svc.from('project_metrics').select('deliverable_id, category_key, metric_key, value, recorded_on, created_at, voided_at').eq('project_id', project.id).eq('org_id', orgId).limit(5000)
  const { data: parties } = await svc.from('project_parties').select('name, role').eq('project_id', project.id).in('role', ['vendor', 'delivery_agent'])
  const forbidden = reportForbiddenNames((parties ?? []).filter((p) => p.role === 'vendor').map((p) => p.name as string), (parties ?? []).filter((p) => p.role === 'delivery_agent').map((p) => p.name as string))

  const report = buildReport({
    generatedAt: now.toISOString(), asOf: utcToday(now), title: settings.title ?? project.name, brandName, branding: settings.branding, agentName,
    deliverables: (dels ?? []) as unknown as RawDeliverable[], proofs: (proofs ?? []) as unknown as RawProof[],
    entries: ((entries ?? []) as unknown as RawEntry[]).map((e) => ({ ...e, value: Number(e.value) })), defs
  })
  return { report, leaks: reportLeaks(report, forbidden), settings }
}

/** Saves the report as it stands NOW, frozen. Automatic kinds are idempotent per day. A snapshot containing a forbidden name is still saved (it is a record) but can never be shown externally. */
export async function takeSnapshot(orgId: string, project: ReportProject, o: { trigger: 'manual' | 'cadence' | 'closing'; takenBy: string | null }): Promise<{ id: string; created: boolean; leaks: string[]; period_date: string }> {
  const svc = supabaseService()
  const { report, leaks } = await assembleReport(orgId, project)
  const period = utcToday()
  const content = JSON.parse(JSON.stringify(report))
  const hash = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex')
  const { data, error } = await svc.from('report_snapshots').insert({ org_id: orgId, project_id: project.id, trigger: o.trigger, period_date: period, taken_by: o.takenBy, content, content_hash: hash, leaks }).select('id').single()
  if (error?.code === '23505' && o.trigger !== 'manual') {
    const { data: ex } = await svc.from('report_snapshots').select('id, leaks').eq('project_id', project.id).eq('period_date', period).eq('trigger', o.trigger).single()
    return { id: ex!.id, created: false, leaks: ex!.leaks ?? [], period_date: period }
  }
  if (error) throw new Error(error.message)
  return { id: data.id, created: true, leaks, period_date: period }
}
