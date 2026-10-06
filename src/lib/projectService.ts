import { supabaseService } from './supabaseServer'
import { ApiError } from './auth'
import { toCents } from './billing'
import { templateForCategories, effectiveStatus, phaseProgress, gateStatus, summariseOpenRequests, ruleSatisfied, type ProjectFacts, type GateRule, type ItemStatus } from './projects'
import { projectDelivery, deliveryPct, type DeliveryItem, type DeliveryStatus } from './delivery'
import { writeAudit } from './serviceLayer'

const emptyFacts = (): ProjectFacts => ({ contractExists: false, contractFileUploaded: false, receivables: { total: 0, issued: 0, paid: 0 } })

/** Contract and invoice FACTS for many deals at once (counts and booleans only — never amounts). */
export async function loadFactsBulk(orgId: string, dealIds: string[]): Promise<Map<string, ProjectFacts>> {
  const svc = supabaseService()
  const out = new Map<string, ProjectFacts>(dealIds.map((d) => [d, emptyFacts()]))
  if (!dealIds.length) return out
  const { data: contracts } = await svc.from('contracts').select('id, deal_id').eq('org_id', orgId).in('deal_id', dealIds)
  const dealByContract = new Map((contracts ?? []).map((c) => [c.id as string, c.deal_id as string]))
  for (const c of contracts ?? []) out.get(c.deal_id)!.contractExists = true
  if (!dealByContract.size) return out
  const ids = Array.from(dealByContract.keys())
  const [files, invoices] = await Promise.all([
    svc.from('files').select('linked_id').eq('org_id', orgId).eq('linked_type', 'contract').eq('kind', 'contract_file').in('linked_id', ids),
    svc.from('invoices').select('contract_id, amount, status, payments(amount)').eq('org_id', orgId).eq('direction', 'receivable').neq('status', 'void').in('contract_id', ids)
  ])
  for (const f of files.data ?? []) out.get(dealByContract.get(f.linked_id)!)!.contractFileUploaded = true
  for (const i of invoices.data ?? []) {
    const f = out.get(dealByContract.get(i.contract_id)!)!
    f.receivables.total++
    if (i.status === 'issued') { f.receivables.issued++; if (((i.payments ?? []) as { amount: number }[]).reduce((s, p) => s + toCents(p.amount), 0) >= toCents(i.amount)) f.receivables.paid++ }
  }
  return out
}

/** Deliverables per deal, through the contract. A deal with no contract simply has none yet. */
export async function loadDeliverablesByDeal(orgId: string, dealIds: string[]) {
  const svc = supabaseService()
  const out = new Map<string, Record<string, unknown>[]>(dealIds.map((d) => [d, []]))
  if (!dealIds.length) return { byDeal: out, contractByDeal: new Map<string, string>() }
  const { data: contracts } = await svc.from('contracts').select('id, deal_id').eq('org_id', orgId).in('deal_id', dealIds)
  const dealByContract = new Map((contracts ?? []).map((c) => [c.id as string, c.deal_id as string]))
  const contractByDeal = new Map((contracts ?? []).map((c) => [c.deal_id as string, c.id as string]))
  if (!dealByContract.size) return { byDeal: out, contractByDeal }
  const { data, error } = await svc.from('deliverables')
    .select('id, contract_id, description, due_date, status, planned_quantity, delivered_quantity, unit, make_good_of, invoice_adjustment, adjustment_note, owner:profiles!deliverables_owner_id_fkey(full_name)')
    .in('contract_id', Array.from(dealByContract.keys())).order('due_date', { ascending: true, nullsFirst: false })
  if (error) throw new ApiError(500, `Could not load deliverables: ${error.message}`)
  for (const d of data ?? []) out.get(dealByContract.get(d.contract_id)!)!.push({ ...d, planned_quantity: Number(d.planned_quantity), delivered_quantity: Number(d.delivered_quantity), pct: deliveryPct(Number(d.planned_quantity), Number(d.delivered_quantity)), owner_name: (d.owner as unknown as { full_name: string } | null)?.full_name ?? null, owner: undefined })
  return { byDeal: out, contractByDeal }
}
const toDelivery = (rows: Record<string, unknown>[]): DeliveryItem[] => rows.map((r) => ({ status: r.status as DeliveryStatus, planned: Number(r.planned_quantity), delivered: Number(r.delivered_quantity) }))

/**
 * L1: create the project for a won deal. IDEMPOTENT (a double-click or a retry returns the existing one) and all-or-nothing:
 * if copying the checklist or the parties fails, the half-made project is removed so a retry starts clean.
 */
export async function ensureProject(orgId: string, dealId: string, actorId: string | null): Promise<{ id: string; created: boolean }> {
  const svc = supabaseService()
  const { data: existing } = await svc.from('projects').select('id').eq('deal_id', dealId).maybeSingle()
  if (existing) return { id: existing.id, created: false }

  const { data: deal } = await svc.from('deals').select('id, proposal_id').eq('id', dealId).eq('org_id', orgId).maybeSingle()
  if (!deal) throw new ApiError(404, 'Deal not found')
  const { data: proposal } = await svc.from('proposals').select('id, brand_id, created_by, brands(name), routes(agent_id, agents(name))').eq('id', deal.proposal_id).eq('org_id', orgId).maybeSingle()
  if (!proposal) throw new ApiError(400, 'This deal has no proposal to build a project from')
  const { data: lines } = await svc.from('proposal_lines').select('items(properties(name, category_key, vendor_id, delivery_side_agent_id, vendors(name)))').eq('proposal_id', proposal.id)
  type Prop = { name: string; category_key: string; vendor_id: string | null; delivery_side_agent_id: string | null; vendors: { name: string } | null }
  const props = (lines ?? []).map((l) => (l.items as unknown as { properties: Prop | null } | null)?.properties).filter((p): p is Prop => !!p)

  const templateKey = templateForCategories(props.map((p) => p.category_key))
  const brandName = (proposal.brands as unknown as { name: string } | null)?.name ?? 'Project'
  const ownerId = proposal.created_by ?? actorId
  const { data: owner } = ownerId ? await svc.from('profiles').select('full_name').eq('id', ownerId).maybeSingle() : { data: null }

  const { data: project, error } = await svc.from('projects').insert({
    org_id: orgId, deal_id: dealId, name: `${brandName} — ${props[0]?.name ?? 'Project'}`.slice(0, 200), template_key: templateKey, owner_id: ownerId, created_by: actorId
  }).select('id').single()
  if (error?.code === '23505') { const { data: raced } = await svc.from('projects').select('id').eq('deal_id', dealId).single(); return { id: raced!.id, created: false } }
  if (error || !project) throw new ApiError(500, `Could not create the project: ${error?.message}`)

  try {
    const { data: tItems, error: tErr } = await svc.from('checklist_template_items').select('id, phase_no, phase_name, side, title, auto_rule, position').eq('template_key', templateKey).eq('active', true).order('phase_no').order('position')
    if (tErr) throw new Error(tErr.message)
    if (tItems?.length) {
      const { error: iErr } = await svc.from('project_checklist_items').insert(tItems.map((t) => ({ org_id: orgId, project_id: project.id, template_item_id: t.id, phase_no: t.phase_no, phase_name: t.phase_name, side: t.side, title: t.title, auto_rule: t.auto_rule, position: t.position })))
      if (iErr) throw new Error(iErr.message)
    }
    const route = proposal.routes as unknown as { agent_id: string | null; agents: { name: string } | null } | null
    const parties: Record<string, unknown>[] = [
      { role: 'brand', side: 'brand', name: brandName, ref_type: 'brand', ref_id: proposal.brand_id },
      route?.agent_id ? { role: 'brand_route', side: 'brand', name: route.agents?.name ?? 'Agent', ref_type: 'agent', ref_id: route.agent_id } : { role: 'brand_route', side: 'brand', name: 'Direct (no agent)' },
      { role: 'emergex_owner', side: 'emergex', name: owner?.full_name ?? 'Unassigned', ...(ownerId ? { ref_type: 'profile', ref_id: ownerId } : {}) }
    ]
    const agentIds = Array.from(new Set(props.map((p) => p.delivery_side_agent_id).filter((x): x is string => !!x)))
    if (agentIds.length) { const { data: ags } = await svc.from('agents').select('id, name').in('id', agentIds).eq('org_id', orgId); for (const a of ags ?? []) parties.push({ role: 'delivery_agent', side: 'delivery', name: a.name, ref_type: 'agent', ref_id: a.id }) }
    const seen = new Set<string>(); for (const p of props) if (p.vendor_id && !seen.has(p.vendor_id)) { seen.add(p.vendor_id); parties.push({ role: 'vendor', side: 'delivery', name: p.vendors?.name ?? 'Vendor', ref_type: 'vendor', ref_id: p.vendor_id }) }
    const { error: pErr } = await svc.from('project_parties').insert(parties.map((p) => ({ org_id: orgId, project_id: project.id, ...p })))
    if (pErr) throw new Error(pErr.message)
  } catch (e) {
    await svc.from('projects').delete().eq('id', project.id) // children cascade: nothing half-built is left behind
    throw new ApiError(500, `Could not build the project: ${e instanceof Error ? e.message : String(e)}`)
  }
  await writeAudit({ orgId, actorId: actorId ?? ownerId ?? orgId, action: 'project_created', entityType: 'project', entityId: project.id, after: { deal_id: dealId, template: templateKey } })
  return { id: project.id, created: true }
}

const today = () => new Date().toISOString().slice(0, 10)
const checklistPct = (items: { status: ItemStatus }[]) => { const na = items.filter((i) => i.status === 'na').length; const done = items.filter((i) => i.status === 'done').length; return items.length - na === 0 ? null : Math.round((done / (items.length - na)) * 100) }

/** Everything the project page shows. Paperwork items are evaluated against the CURRENT contract/invoice records every time. */
export async function loadProjectDetail(orgId: string, projectId: string) {
  const svc = supabaseService()
  const { data: p, error } = await svc.from('projects')
    .select('id, name, status, template_key, deal_id, parent_project_id, owner_id, created_at, owner:profiles!projects_owner_id_fkey(full_name), deals(proposals(brands(name)))')
    .eq('id', projectId).eq('org_id', orgId).maybeSingle()
  if (error) throw new ApiError(500, error.message)
  if (!p) throw new ApiError(404, 'Project not found')

  const [children, parent, tmpl, items, parties, comms] = await Promise.all([
    svc.from('projects').select('id, name, deal_id, status').eq('org_id', orgId).eq('parent_project_id', projectId).order('created_at'),
    p.parent_project_id ? svc.from('projects').select('id, name').eq('id', p.parent_project_id).maybeSingle() : Promise.resolve({ data: null }),
    svc.from('checklist_templates').select('name').eq('key', p.template_key).maybeSingle(),
    svc.from('project_checklist_items').select('id, template_item_id, phase_no, phase_name, side, title, auto_rule, status, due_date, notes, na_reason, position, owner_id, completed_at, owner:profiles!project_checklist_items_owner_id_fkey(full_name)').eq('project_id', projectId).is('archived_at', null).order('phase_no').order('position'),
    svc.from('project_parties').select('id, role, side, name, ref_type, ref_id, contact, notes').eq('project_id', projectId).is('archived_at', null).order('created_at'),
    svc.from('project_communications').select('id, status, waiting_on, party_id, occurred_at, kind').eq('project_id', projectId).eq('status', 'open')
  ])
  const childRows = children.data ?? []
  const dealIds = [p.deal_id, ...childRows.map((c) => c.deal_id)]
  const [facts, dels] = await Promise.all([loadFactsBulk(orgId, dealIds), loadDeliverablesByDeal(orgId, dealIds)])
  const f = facts.get(p.deal_id)!

  const checklist = (items.data ?? []).map((i) => {
    const eff = effectiveStatus({ status: i.status as ItemStatus, auto_rule: i.auto_rule as GateRule | null }, f)
    return {
      id: i.id, phase_no: i.phase_no, phase_name: i.phase_name, side: i.side as 'brand' | 'team', title: i.title, status: i.status, effective_status: eff,
      auto: !!i.auto_rule, auto_satisfied: ruleSatisfied(i.auto_rule as GateRule | null, f), due_date: i.due_date, notes: i.notes, na_reason: i.na_reason,
      owner_id: i.owner_id, owner_name: (i.owner as unknown as { full_name: string } | null)?.full_name ?? null, is_custom: !i.template_item_id,
      overdue: eff === 'open' && !!i.due_date && i.due_date < today()
    }
  })
  const progress = phaseProgress(checklist.map((c) => ({ phase_no: c.phase_no, phase_name: c.phase_name, side: c.side, status: c.effective_status })))
  const own = dels.byDeal.get(p.deal_id) ?? []
  const allDeliverables = dealIds.flatMap((d) => dels.byDeal.get(d) ?? [])
  return {
    project: {
      id: p.id, name: p.name, status: p.status, template_key: p.template_key, template_name: tmpl.data?.name ?? p.template_key, deal_id: p.deal_id,
      brand_name: ((p.deals as unknown as { proposals: { brands: { name: string } | null } | null } | null)?.proposals?.brands?.name) ?? '', owner_id: p.owner_id,
      owner_name: (p.owner as unknown as { full_name: string } | null)?.full_name ?? null, parent: parent.data ?? null, created_at: p.created_at
    },
    contract_id: dels.contractByDeal.get(p.deal_id) ?? null,
    checklist: { phases: progress.map((ph) => ({ ...ph, items: checklist.filter((c) => c.phase_no === ph.phase_no) })), gate: gateStatus(progress.find((x) => x.phase_no === 1)), overall_pct: checklistPct(checklist.map((c) => ({ status: c.effective_status }))) },
    parties: parties.data ?? [],
    deliverables: { items: own, summary: projectDelivery(toDelivery(own)) },
    upsells: childRows.map((c) => ({ id: c.id, name: c.name, status: c.status, delivery: projectDelivery(toDelivery(dels.byDeal.get(c.deal_id) ?? [])) })),
    combined_delivery: childRows.length ? projectDelivery(toDelivery(allDeliverables)) : null,
    requests: summariseOpenRequests(comms.data ?? [])
  }
}

/** Owners and assignees must be members of STAFF in this organisation — never an agent, never another organisation's user. */
export async function assertStaff(orgId: string, userId: unknown): Promise<string> {
  const { isUuid } = await import('./ids')
  if (!isUuid(userId)) throw new ApiError(400, 'That person is not valid')
  const { data } = await supabaseService().from('profiles').select('id, disabled, roles(is_external)').eq('id', userId).eq('org_id', orgId).maybeSingle()
  if (!data || data.disabled || (data.roles as unknown as { is_external: boolean } | null)?.is_external) throw new ApiError(400, 'That person must be an active member of staff')
  return userId
}
export async function loadOwnProject(orgId: string, projectId: string) {
  const { isUuid } = await import('./ids')
  if (!isUuid(projectId)) throw new ApiError(404, 'Project not found')
  const { data } = await supabaseService().from('projects').select('id, deal_id').eq('id', projectId).eq('org_id', orgId).maybeSingle()
  if (!data) throw new ApiError(404, 'Project not found')
  return data
}
