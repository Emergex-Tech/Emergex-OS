import { supabaseService } from './supabaseServer'
import { listInvoices } from './finance'

export interface NotificationItem { label: string; detail: string; link: string; severity: 'info' | 'warn' | 'urgent' }
export interface NotificationGroup { title: string; items: NotificationItem[] }

const STALLED_AFTER_DAYS = 7

/**
 * A34, built per the PRD's own fallback when time is short: "Dashboard lists plus a weekly
 * email" (the email half isn't built — no SMTP is configured anywhere in this project, and
 * adding one wasn't asked for). This aggregates what's actually actionable right now, grouped
 * the way a person would triage it, rather than raw counts.
 */
export async function buildNotifications(orgId: string, opts: { finance: boolean } = { finance: false }): Promise<NotificationGroup[]> {
  const svc = supabaseService()
  const today = new Date().toISOString().slice(0, 10)
  const soon = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
  const renewalSoon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
  const stallCutoff = new Date(Date.now() - STALLED_AFTER_DAYS * 86_400_000).toISOString()

  const [staleProps, staleItems, expiringOffers, scoreChanges, overrides, shareOverrides, openProposals, renewals, overdueDeliverables] = await Promise.all([
    svc.from('properties').select('id, name').eq('org_id', orgId).eq('is_stale', true).limit(20),
    svc.from('items').select('id, name').eq('org_id', orgId).eq('is_stale', true).limit(20),
    svc.from('items').select('id, name, offer_expiry').eq('org_id', orgId).lte('offer_expiry', soon).gte('offer_expiry', today).limit(20),
    svc.from('route_score_changes').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'pending'),
    svc.from('reconfirmation_overrides').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'pending'),
    svc.from('share_conflict_overrides').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'pending'),
    svc.from('proposals').select('id, updated_at, brands(name)').eq('org_id', orgId).not('stage', 'in', '(Won,Lost)'),
    svc.from('contracts').select('id, renewal_date, deals(proposals(brands(name)))').eq('org_id', orgId).eq('status', 'active').lte('renewal_date', renewalSoon).gte('renewal_date', today),
    svc.from('deliverables').select('id, description, due_date, contract_id').eq('org_id', orgId).eq('status', 'pending').lt('due_date', today).limit(20)
  ])

  const groups: NotificationGroup[] = []

  const stale: NotificationItem[] = [
    ...(staleProps.data ?? []).map((p) => ({ label: p.name, detail: 'Property not re-confirmed on schedule', link: '/inventory', severity: 'warn' as const })),
    ...(staleItems.data ?? []).map((i) => ({ label: i.name, detail: 'Item not re-confirmed on schedule', link: '/inventory', severity: 'warn' as const })),
    ...(expiringOffers.data ?? []).map((i) => ({ label: i.name, detail: `Offer expires ${i.offer_expiry}`, link: '/inventory', severity: 'urgent' as const }))
  ]
  if (stale.length) groups.push({ title: 'Due & stale', items: stale })

  const approvals: NotificationItem[] = []
  if ((scoreChanges.count ?? 0) > 0) approvals.push({ label: `${scoreChanges.count} route score change${scoreChanges.count === 1 ? '' : 's'}`, detail: 'Pending your review', link: '/approvals', severity: 'info' })
  if ((overrides.count ?? 0) > 0) approvals.push({ label: `${overrides.count} reconfirmation override${overrides.count === 1 ? '' : 's'}`, detail: 'Pending your review', link: '/approvals', severity: 'info' })
  if ((shareOverrides.count ?? 0) > 0) approvals.push({ label: `${shareOverrides.count} share conflict override${shareOverrides.count === 1 ? '' : 's'}`, detail: 'Pending your review', link: '/approvals', severity: 'info' })
  if (approvals.length) groups.push({ title: 'Pending approvals', items: approvals })

  const stalled = (openProposals.data ?? [])
    .filter((p) => p.updated_at < stallCutoff)
    .map((p) => ({
      label: (p.brands as unknown as { name: string } | null)?.name ?? '(proposal)',
      detail: `No activity since ${new Date(p.updated_at).toLocaleDateString()}`,
      link: `/proposals/${p.id}`, severity: 'warn' as const
    }))
  if (stalled.length) groups.push({ title: 'Stalled proposals', items: stalled })

  const renewalItems = (renewals.data ?? []).map((c) => ({
    label: (c.deals as unknown as { proposals: { brands: { name: string } } })?.proposals?.brands?.name ?? '(contract)',
    detail: `Renews ${c.renewal_date}`, link: '/contracts', severity: 'info' as const
  }))
  if (renewalItems.length) groups.push({ title: 'Upcoming renewals', items: renewalItems })

  const overdueItems = (overdueDeliverables.data ?? []).map((d) => ({
    label: d.description, detail: `Was due ${d.due_date}`, link: '/contracts', severity: 'urgent' as const
  }))
  if (overdueItems.length) groups.push({ title: 'Overdue deliverables', items: overdueItems })

  // Money notifications only for people who hold finance.manage — otherwise this feed would quietly
  // leak exactly what that permission (and the RLS on invoices) exists to keep from Team.
  if (opts.finance) {
    const overdue = (await listInvoices(orgId)).filter((i) => i.overdue)
    const receivables = overdue.filter((i) => i.direction === 'receivable').sort((a, b) => b.days_overdue - a.days_overdue)
    const payables = overdue.filter((i) => i.direction === 'payable').sort((a, b) => b.days_overdue - a.days_overdue)
    if (receivables.length) groups.push({ title: 'Overdue invoices', items: receivables.map((i) => ({
      label: `${i.number} — ${i.counterparty_name}`,
      detail: `${i.currency} ${i.balance.toLocaleString()} outstanding, ${i.days_overdue} day${i.days_overdue === 1 ? '' : 's'} overdue${i.needs_chase ? ' · chase due' : ''}`,
      link: `/finance/${i.id}`, severity: 'urgent' as const })) })
    if (payables.length) groups.push({ title: 'Payables past due', items: payables.map((i) => ({
      label: `${i.number} — ${i.counterparty_name}`, detail: `${i.currency} ${i.balance.toLocaleString()} owed, ${i.days_overdue} day${i.days_overdue === 1 ? '' : 's'} past due`,
      link: `/finance/${i.id}`, severity: 'warn' as const })) })
  }

  return groups
}
