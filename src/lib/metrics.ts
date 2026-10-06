// Pure logic for metrics (L13–L14), proof links (L11) and project risk (L26–L27) — no database.

export interface MetricDef { category_key: string; key: string; label: string; unit: string | null; aggregation: 'sum' | 'avg'; position: number; active: boolean }
export interface MetricEntry { deliverable_id: string | null; category_key: string; metric_key: string; value: number; recorded_on: string; created_at: string; voided_at?: string | null }

/**
 * Each entry is the cumulative total AS OF its date. For every (deliverable, metric) the LATEST non-voided entry counts —
 * so a newer reading replaces an older one instead of adding to it. Same date: the later-created entry wins.
 */
export function latestPerSubject(entries: MetricEntry[]): MetricEntry[] {
  const best = new Map<string, MetricEntry>()
  for (const e of entries) {
    if (e.voided_at) continue
    const k = `${e.deliverable_id ?? '(project)'}|${e.category_key}|${e.metric_key}`
    const cur = best.get(k)
    if (!cur || e.recorded_on > cur.recorded_on || (e.recorded_on === cur.recorded_on && e.created_at > cur.created_at)) best.set(k, e)
  }
  return Array.from(best.values())
}

export interface MetricSummary { category_key: string; metric_key: string; label: string; unit: string | null; aggregation: 'sum' | 'avg'; value: number; subjects: number; as_of: string }
/**
 * Headline figure per metric: counts are SUMMED across deliverables, rates are AVERAGED (unweighted — a rate over a tiny
 * deliverable counts as much as one over a huge one; weighting needs the underlying counts, which are not recorded).
 */
export function summariseMetrics(entries: MetricEntry[], defs: MetricDef[]): MetricSummary[] {
  const latest = latestPerSubject(entries)
  const out: MetricSummary[] = []
  for (const d of [...defs].sort((a, b) => a.position - b.position)) {
    const rows = latest.filter((e) => e.category_key === d.category_key && e.metric_key === d.key)
    if (!rows.length) continue
    const total = rows.reduce((s, e) => s + Number(e.value), 0)
    out.push({ category_key: d.category_key, metric_key: d.key, label: d.label, unit: d.unit, aggregation: d.aggregation,
      value: Math.round((d.aggregation === 'avg' ? total / rows.length : total) * 10000) / 10000, subjects: rows.length, as_of: rows.map((r) => r.recorded_on).sort().pop()! })
  }
  return out
}

export function validateMetricValue(def: Pick<MetricDef, 'unit'>, value: unknown): { ok: true; value: number } | { ok: false; reason: string } {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, reason: 'The value must be a number' }
  if (n < 0) return { ok: false, reason: 'The value cannot be negative' }
  if (n > 1e12) return { ok: false, reason: 'That value is too large' }
  if (def.unit === '%' && n > 100) return { ok: false, reason: 'A percentage cannot be above 100' }
  return { ok: true, value: n }
}

export type DriveLink = { ok: true; url: string; fileId: string | null } | { ok: false; reason: string }
/**
 * L11: a proof can be a link to an existing Drive file. Only a plain https link on Google's own Drive/Docs hosts is accepted
 * (exact host match — "drive.google.com.evil.example" and "evil.example/drive.google.com" are refused), with no embedded
 * credentials, so a stored link can never be a javascript: URL or a look-alike.
 */
export function parseDriveLink(raw: unknown): DriveLink {
  if (typeof raw !== 'string') return { ok: false, reason: 'A link is required' }
  const s = raw.trim()
  if (!s) return { ok: false, reason: 'A link is required' }
  if (s.length > 600) return { ok: false, reason: 'That link is too long' }
  if (/\s/.test(s)) return { ok: false, reason: 'A link cannot contain spaces' }
  let u: URL
  try { u = new URL(s) } catch { return { ok: false, reason: 'That is not a valid link' } }
  if (u.protocol !== 'https:') return { ok: false, reason: 'Only https links are accepted' }
  if (u.username || u.password) return { ok: false, reason: 'A link cannot contain a username or password' }
  if (u.hostname !== 'drive.google.com' && u.hostname !== 'docs.google.com') return { ok: false, reason: 'Only Google Drive or Google Docs links are accepted' }
  const fileId = u.pathname.match(/\/d\/([A-Za-z0-9_-]{10,})/)?.[1] ?? u.searchParams.get('id')
  u.hash = ''
  return { ok: true, url: u.toString(), fileId: fileId && /^[A-Za-z0-9_-]{10,}$/.test(fileId) ? fileId : null }
}

/** Delivered (even partly) but no proof on file. */
export const proofMissing = (d: { status: string; delivered_quantity: number }, proofCount: number): boolean => proofCount === 0 && Number(d.delivered_quantity) > 0 && (d.status === 'delivered' || d.status === 'partial')

export const STALE_REQUEST_DAYS = 5
export interface RiskInput { overdueDeliverables: number; missedUnresolved: number; oldestWaitingOnUsDays: number | null; overdueSteps: number }
export interface RiskReason { code: 'overdue_deliverables' | 'missed_unresolved' | 'stale_request' | 'overdue_steps'; count: number; detail: string }
/**
 * L26 "delivery at risk". Every reason is listed with its count, so "at risk" is never a mystery:
 * overdue deliverables; a missed deliverable nobody has resolved (no make-good, no invoice-adjustment flag);
 * a request waiting on US for more than 5 days; overdue checklist steps.
 */
export function assessRisk(i: RiskInput): { atRisk: boolean; reasons: RiskReason[] } {
  const reasons: RiskReason[] = []
  if (i.overdueDeliverables > 0) reasons.push({ code: 'overdue_deliverables', count: i.overdueDeliverables, detail: `${i.overdueDeliverables} deliverable${i.overdueDeliverables === 1 ? ' is' : 's are'} past due` })
  if (i.missedUnresolved > 0) reasons.push({ code: 'missed_unresolved', count: i.missedUnresolved, detail: `${i.missedUnresolved} missed deliverable${i.missedUnresolved === 1 ? '' : 's'} with no make-good or invoice adjustment` })
  if (i.oldestWaitingOnUsDays != null && i.oldestWaitingOnUsDays > STALE_REQUEST_DAYS) reasons.push({ code: 'stale_request', count: 1, detail: `a request has been waiting on us for ${i.oldestWaitingOnUsDays} days` })
  if (i.overdueSteps > 0) reasons.push({ code: 'overdue_steps', count: i.overdueSteps, detail: `${i.overdueSteps} checklist step${i.overdueSteps === 1 ? ' is' : 's are'} overdue` })
  return { atRisk: reasons.length > 0, reasons }
}
