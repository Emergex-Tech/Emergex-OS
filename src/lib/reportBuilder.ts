// The brand-facing report (L16). PURE — no database.
//
// SECURITY MODEL: this file is the ONLY place that decides what an outside reader can see, and it works by CONSTRUCTING each
// field from an allow-list. It never copies or spreads a database row, so a column added to a table tomorrow (a cost, a note, a
// vendor) cannot appear here by accident. What a report must never show: money of any kind, vendors/talent, delivery-side agents,
// internal notes, the invoice-adjustment flag, who recorded what, a metric's free-text source, the checklist or the log.
import { deliveryPct, projectDelivery, type DeliveryStatus } from './delivery'
import { summariseMetrics, type MetricDef, type MetricEntry } from './metrics'
import { hiddenNames, findLeaks, fmtNum } from './caseStudy'

export type Branding = 'emergex' | 'agent' | 'co_branded'
type Extra = Record<string, unknown>   // rows from the database carry MANY more columns than the report may use — tests plant secrets in them
export interface RawDeliverable extends Extra { id: string; description: string; status: string; planned_quantity: number; delivered_quantity: number; unit: string | null; due_date: string | null }
export interface RawProof extends Extra { id: string; deliverable_id: string; name: string; kind: string; created_at: string; report_visible: boolean; archived_at: string | null }
export type RawEntry = MetricEntry & Extra
export interface ReportInput {
  generatedAt: string; asOf: string; title: string; brandName: string
  branding: Branding; agentName: string | null
  deliverables: RawDeliverable[]; proofs: RawProof[]; entries: RawEntry[]; defs: MetricDef[]
}
export interface ReportProof { id: string; name: string; kind: 'upload' | 'link'; added_on: string; url: string | null }
export interface ReportDeliverable { id: string; description: string; status: string; planned: number; delivered: number; unit: string | null; pct: number; due_date: string | null; proofs: ReportProof[] }
export interface ReportMetric { label: string; value: number; unit: string | null; aggregation: 'sum' | 'avg'; as_of: string; readings: number }
export interface ReportSeries { label: string; unit: string | null; points: { date: string; value: number }[] }
export interface ReportEvent { date: string; type: 'due' | 'proof' | 'reading'; text: string }
export interface Report {
  generated_at: string; as_of: string; title: string; brand_name: string
  branding: { mode: Branding; agent_name: string | null }
  delivery: { pct: number | null; counted: number; delivered: number; partial: number; planned: number; missed: number; replaced_excluded: number }
  deliverables: ReportDeliverable[]
  metrics: { summary: ReportMetric[]; series: ReportSeries[] }
  timeline: ReportEvent[]
}
export const REPORT_KEYS = ['generated_at', 'as_of', 'title', 'brand_name', 'branding', 'delivery', 'deliverables', 'metrics', 'timeline'] as const

/** "Total as of each reading date" for every metric — replays the readings, so a newer reading REPLACES an older one (never double-counts). */
export function metricSeries(entries: MetricEntry[], defs: MetricDef[]): ReportSeries[] {
  const out: ReportSeries[] = []
  for (const d of [...defs].sort((a, b) => a.position - b.position)) {
    const mine = entries.filter((e) => !e.voided_at && e.category_key === d.category_key && e.metric_key === d.key)
    if (!mine.length) continue
    const dates = Array.from(new Set(mine.map((e) => e.recorded_on))).sort()
    out.push({ label: d.label, unit: d.unit, points: dates.map((date) => ({ date, value: summariseMetrics(mine.filter((e) => e.recorded_on <= date), [d])[0].value })) })
  }
  return out
}

const STATUSES = new Set(['planned', 'delivered', 'partial', 'missed', 'replaced'])
export function buildReport(i: ReportInput): Report {
  const live = i.deliverables.filter((d) => STATUSES.has(d.status))
  const summary = projectDelivery(live.map((d) => ({ status: d.status as DeliveryStatus, planned: Number(d.planned_quantity), delivered: Number(d.delivered_quantity) })))
  const visible = i.proofs.filter((p) => p.report_visible === true && !p.archived_at)
  const byDel = new Map(live.map((d) => [d.id, d.description]))

  const deliverables: ReportDeliverable[] = live.map((d) => ({
    id: String(d.id), description: String(d.description), status: String(d.status), planned: Number(d.planned_quantity), delivered: Number(d.delivered_quantity), unit: d.unit == null ? null : String(d.unit),
    pct: d.status === 'replaced' ? 0 : deliveryPct(Number(d.planned_quantity), Number(d.delivered_quantity)), due_date: d.due_date == null ? null : String(d.due_date),
    proofs: visible.filter((p) => p.deliverable_id === d.id).map((p) => ({ id: String(p.id), name: String(p.name), kind: p.kind === 'link' ? 'link' as const : 'upload' as const, added_on: String(p.created_at).slice(0, 10), url: p.kind === 'link' && typeof p.url === 'string' ? p.url : null }))
  }))
  const entries = i.entries.filter((e) => !e.voided_at)
  const defsWithData = i.defs
  const metrics = summariseMetrics(entries, defsWithData).map((m) => ({ label: m.label, value: m.value, unit: m.unit, aggregation: m.aggregation, as_of: m.as_of, readings: m.subjects }))
  const defLabel = (e: MetricEntry) => defsWithData.find((d) => d.category_key === e.category_key && d.key === e.metric_key)

  const events: ReportEvent[] = [
    ...live.filter((d) => d.due_date && d.status !== 'replaced').map((d) => ({ date: String(d.due_date), type: 'due' as const, text: `${d.description} — due` })),
    ...visible.filter((p) => byDel.has(p.deliverable_id)).map((p) => ({ date: String(p.created_at).slice(0, 10), type: 'proof' as const, text: `Proof added: ${byDel.get(p.deliverable_id)}` })),
    ...entries.filter((e) => defLabel(e)).map((e) => { const d = defLabel(e)!; return { date: e.recorded_on, type: 'reading' as const, text: `${d.label} reported: ${fmtNum(Number(e.value))}${d.unit === '%' ? '%' : ''}${e.deliverable_id && byDel.get(e.deliverable_id) ? ` (${byDel.get(e.deliverable_id)})` : ''}` } })
  ].sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || a.text.localeCompare(b.text)).slice(-200)

  return {
    generated_at: i.generatedAt, as_of: i.asOf, title: i.title, brand_name: i.brandName,
    branding: { mode: i.branding, agent_name: i.branding === 'emergex' ? null : i.agentName },
    delivery: { pct: summary.pct, counted: summary.counted, delivered: summary.delivered, partial: summary.partial, planned: summary.planned, missed: summary.missed, replaced_excluded: summary.replacedExcluded },
    deliverables, metrics: { summary: metrics, series: metricSeries(entries, defsWithData) }, timeline: events
  }
}

/** Every piece of TEXT in the report (values, not keys) — what a reader could actually read. */
export function reportText(r: unknown): string {
  const out: string[] = []
  const walk = (v: unknown) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v as object).forEach(walk) }
  walk(r); return out.join('\n')
}
/** Names that must never appear in a brand's report: the vendors/talent and the delivery-side agents (D18: hidden by default). */
export const reportForbiddenNames = (vendors: string[], deliveryAgents: string[]): string[] => hiddenNames({ brand: [], projectName: '', partners: [...vendors, ...deliveryAgents] }).all
/** The fail-closed check: if any forbidden name is readable in the report, it must not be shown externally. */
export const reportLeaks = (r: Report, forbidden: string[]): string[] => findLeaks(reportText(r), forbidden)
