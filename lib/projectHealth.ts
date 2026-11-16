import { supabaseService } from './supabaseServer'
import { loadFactsBulk, loadDeliverablesByDeal } from './projectService'
import { effectiveStatus, phaseProgress, gateStatus, type GateRule, type ItemStatus } from './projects'
import { projectDelivery, type DeliveryStatus } from './delivery'
import { assessRisk, proofMissing, type RiskReason } from './metrics'

export interface ProjectHealth {
  id: string; name: string; brand_name: string; owner_name: string | null
  delivery_pct: number | null; gate: 'cleared' | 'open'; waiting_on_us: number
  at_risk: boolean; reasons: RiskReason[]
}
export interface ProjectAlerts {
  waitingOnUs: { project_id: string; project: string; summary: string; days: number }[]
  dueSoon: { project_id: string; project: string; description: string; due_date: string }[]
  proofMissing: { project_id: string; project: string; description: string }[]
  overdueSteps: { project_id: string; project: string; title: string; due_date: string }[]
}
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

/** Everything the CEO view and the notifications need about LIVE (active) projects, computed together so they always agree. */
export async function loadProjectHealth(orgId: string): Promise<{ projects: ProjectHealth[]; alerts: ProjectAlerts }> {
  const svc = supabaseService()
  const { data: rows } = await svc.from('projects')
    .select('id, name, deal_id, owner:profiles!projects_owner_id_fkey(full_name), deals(proposals(brands(name)))').eq('org_id', orgId).eq('status', 'active').order('created_at', { ascending: false }).limit(500)
  const projects = rows ?? []
  const alerts: ProjectAlerts = { waitingOnUs: [], dueSoon: [], proofMissing: [], overdueSteps: [] }
  if (!projects.length) return { projects: [], alerts }
  const ids = projects.map((p) => p.id), dealIds = projects.map((p) => p.deal_id)
  const [facts, dels, items, comms] = await Promise.all([
    loadFactsBulk(orgId, dealIds), loadDeliverablesByDeal(orgId, dealIds),
    svc.from('project_checklist_items').select('project_id, phase_no, phase_name, side, status, auto_rule, title, due_date').in('project_id', ids).is('archived_at', null),
    svc.from('project_communications').select('project_id, waiting_on, occurred_at, summary').in('project_id', ids).eq('status', 'open').eq('waiting_on', 'us').order('occurred_at')
  ])
  const today = iso(0), soon = iso(7)
  const days = (t: string) => Math.max(0, Math.floor((Date.now() - Date.parse(t)) / 86_400_000))

  const out: ProjectHealth[] = projects.map((p) => {
    const name = p.name as string
    const mineDel = (dels.byDeal.get(p.deal_id) ?? []) as { status: DeliveryStatus; planned_quantity: number; delivered_quantity: number; due_date: string | null; invoice_adjustment: boolean; description: string; proof_count: number }[]
    const mineItems = ((items.data ?? []) as { project_id: string; phase_no: number; phase_name: string; side: 'brand' | 'team'; status: ItemStatus; auto_rule: GateRule | null; title: string; due_date: string | null }[]).filter((i) => i.project_id === p.id)
      .map((i) => ({ ...i, eff: effectiveStatus(i, facts.get(p.deal_id)!) }))
    const waiting = (comms.data ?? []).filter((c) => c.project_id === p.id)

    const overdue = mineDel.filter((d) => (d.status === 'planned' || d.status === 'partial') && d.due_date && d.due_date < today)
    const missedUnresolved = mineDel.filter((d) => d.status === 'missed' && !d.invoice_adjustment)
    const overdueSteps = mineItems.filter((i) => i.eff === 'open' && i.due_date && i.due_date < today)
    for (const d of mineDel) {
      if ((d.status === 'planned' || d.status === 'partial') && d.due_date && d.due_date >= today && d.due_date <= soon) alerts.dueSoon.push({ project_id: p.id, project: name, description: d.description, due_date: d.due_date })
      if (proofMissing({ status: d.status, delivered_quantity: Number(d.delivered_quantity) }, Number(d.proof_count))) alerts.proofMissing.push({ project_id: p.id, project: name, description: d.description })
    }
    for (const w of waiting) alerts.waitingOnUs.push({ project_id: p.id, project: name, summary: w.summary, days: days(w.occurred_at) })
    for (const s of overdueSteps) alerts.overdueSteps.push({ project_id: p.id, project: name, title: s.title, due_date: s.due_date! })

    const risk = assessRisk({ overdueDeliverables: overdue.length, missedUnresolved: missedUnresolved.length, oldestWaitingOnUsDays: waiting.length ? Math.max(...waiting.map((w) => days(w.occurred_at))) : null, overdueSteps: overdueSteps.length })
    const prog = phaseProgress(mineItems.map((i) => ({ phase_no: i.phase_no, phase_name: i.phase_name, side: i.side, status: i.eff })))
    return {
      id: p.id, name, brand_name: ((p.deals as unknown as { proposals: { brands: { name: string } | null } | null } | null)?.proposals?.brands?.name) ?? '',
      owner_name: (p.owner as unknown as { full_name: string } | null)?.full_name ?? null,
      delivery_pct: projectDelivery(mineDel.map((d) => ({ status: d.status, planned: Number(d.planned_quantity), delivered: Number(d.delivered_quantity) }))).pct,
      gate: gateStatus(prog.find((x) => x.phase_no === 1)).overall, waiting_on_us: waiting.length, at_risk: risk.atRisk, reasons: risk.reasons
    }
  })
  alerts.waitingOnUs.sort((a, b) => b.days - a.days)
  return { projects: out, alerts }
}
