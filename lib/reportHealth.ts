import { supabaseService } from './supabaseServer'
import { assembleReport, utcToday } from './reportService'
import { overdueDays, CADENCE_LABEL, type Cadence } from './reportCadence'
import { daysLeft, EXPIRING_SOON_DAYS } from './reportToken'

export interface ReportAlerts {
  activeLinks: number
  expiring: { project_id: string; project: string; label: string; days_left: number }[]
  heldBack: { project_id: string; project: string; names: string[] }[]
  overdue: { project_id: string; project: string; cadence: string; days_late: number }[]
}

/**
 * What needs a person's attention about brand reports (L26/L27):
 *  - links that expire within 7 days;
 *  - reports HELD BACK — a project with a live link whose report now contains a forbidden name, so the brand sees nothing until it is fixed;
 *  - snapshots the daily job should have taken but has not (late by a full day or more).
 * Nothing financial in here, so every staff role may see it.
 */
export async function loadReportAlerts(orgId: string, now = new Date()): Promise<ReportAlerts> {
  const svc = supabaseService()
  const out: ReportAlerts = { activeLinks: 0, expiring: [], heldBack: [], overdue: [] }
  const { data: links } = await svc.from('report_links').select('id, project_id, label, expires_at').eq('org_id', orgId).is('revoked_at', null).gt('expires_at', now.toISOString()).limit(2000)
  const { data: settings } = await svc.from('project_report_settings').select('project_id, cadence').eq('org_id', orgId).neq('cadence', 'manual')
  const ids = Array.from(new Set([...(links ?? []).map((l) => l.project_id as string), ...(settings ?? []).map((s) => s.project_id as string)]))
  if (!ids.length) return out
  const { data: projs } = await svc.from('projects').select('id, name, deal_id, status').eq('org_id', orgId).in('id', ids)
  const byId = new Map((projs ?? []).map((p) => [p.id as string, p]))
  out.activeLinks = (links ?? []).length

  for (const l of links ?? []) {
    const p = byId.get(l.project_id); const left = daysLeft(l.expires_at, now.getTime())
    if (p && left <= EXPIRING_SOON_DAYS) out.expiring.push({ project_id: p.id, project: p.name, label: l.label ?? 'Report link', days_left: Math.max(left, 0) })
  }
  out.expiring.sort((a, b) => a.days_left - b.days_left)

  for (const pid of Array.from(new Set((links ?? []).map((l) => l.project_id as string)))) {
    const p = byId.get(pid); if (!p) continue
    const { leaks } = await assembleReport(orgId, p, now)
    if (leaks.length) out.heldBack.push({ project_id: p.id, project: p.name, names: leaks })
  }

  const today = utcToday(now)
  for (const s of settings ?? []) {
    const p = byId.get(s.project_id); if (!p || p.status !== 'active') continue
    const { data: last } = await svc.from('report_snapshots').select('period_date').eq('project_id', p.id).eq('trigger', 'cadence').order('period_date', { ascending: false }).limit(1)
    const late = overdueDays(s.cadence as Cadence, last?.[0]?.period_date ?? null, today)
    if (late > 0) out.overdue.push({ project_id: p.id, project: p.name, cadence: CADENCE_LABEL[s.cadence as Cadence], days_late: late })
  }
  return out
}
