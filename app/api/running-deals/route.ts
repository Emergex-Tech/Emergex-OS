import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { ensureProject } from '@/lib/projectService'
import { isValidIsoDate } from '@/lib/billing'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

const MAX_ITEMS = 20
/**
 * Enters a deal that is ALREADY RUNNING — signed before this system existed — in one step: a proposal marked Won (origin
 * 'running_deal', so it never counts in win-rate statistics), one line per inventory item at the price the brand pays, the deal,
 * the contract and the live project. It needs real inventory items so the project knows its category, vendor and metric sets.
 * Manager/CEO only (it creates a contract and skips pricing approval). NO cost is recorded — none is invented — so margin for
 * these deals shows as unknown. Everything is validated before anything is written.
 */
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'contract.manage')
    await requirePermission(profile, 'project.manage')
    const b = await req.json().catch(() => ({}))
    const svc = supabaseService()
    if (!isUuid(b.brand_id)) throw new ApiError(400, 'Choose the brand')
    if (!isUuid(b.route_id)) throw new ApiError(400, 'Choose how the brand deals with us (the route)')
    if (typeof b.renewal_date !== 'string' || !isValidIsoDate(b.renewal_date)) throw new ApiError(400, 'renewal_date must be a valid date (YYYY-MM-DD) — the day the contract ends or renews')
    const currency = typeof b.currency === 'string' && /^[A-Z]{3}$/.test(b.currency) ? b.currency : null
    if (!currency) throw new ApiError(400, 'currency must be a 3-letter code such as USD')
    if (b.terms != null && (typeof b.terms !== 'string' || b.terms.length > 5000)) throw new ApiError(400, 'terms can be at most 5000 characters')
    // when it was actually signed — so the revenue view books it in the right month, not the month it was typed in
    if (b.signed_on != null && (typeof b.signed_on !== 'string' || !isValidIsoDate(b.signed_on) || b.signed_on > new Date().toISOString().slice(0, 10))) throw new ApiError(400, 'signed_on must be a valid date that is not in the future')
    if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > MAX_ITEMS) throw new ApiError(400, `List between 1 and ${MAX_ITEMS} inventory items`)
    const items: { item_id: string; sell_price: number }[] = b.items.map((x: { item_id?: unknown; sell_price?: unknown }, i: number) => {
      const price = Number(x?.sell_price)
      if (!isUuid(x?.item_id)) throw new ApiError(400, `Item ${i + 1}: choose an inventory item`)
      if (x?.sell_price == null || x.sell_price === '' || !Number.isFinite(price) || price < 0 || price > 1e12) throw new ApiError(400, `Item ${i + 1}: the price the brand pays must be a number of 0 or more`)
      return { item_id: x.item_id as string, sell_price: Math.round(price * 100) / 100 }
    })
    if (new Set(items.map((x) => x.item_id)).size !== items.length) throw new ApiError(400, 'The same item is listed twice')

    const { data: brand } = await svc.from('brands').select('id, name').eq('id', b.brand_id).eq('org_id', profile.org_id).maybeSingle()
    if (!brand) throw new ApiError(400, 'That brand does not exist')
    const { data: route } = await svc.from('routes').select('id, brand_id').eq('id', b.route_id).eq('org_id', profile.org_id).maybeSingle()
    if (!route || route.brand_id !== brand.id) throw new ApiError(400, 'That route does not belong to this brand')
    const { data: found } = await svc.from('items').select('id').eq('org_id', profile.org_id).in('id', items.map((x) => x.item_id))
    if ((found ?? []).length !== items.length) throw new ApiError(400, 'One of the items does not exist')

    const total = Math.round(items.reduce((s, x) => s + x.sell_price, 0) * 100) / 100
    const now = new Date().toISOString()
    const { data: proposal, error: pe } = await svc.from('proposals').insert({ org_id: profile.org_id, brand_id: brand.id, route_id: route.id, brief: typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 2000) : 'Entered as a deal that was already running', budget: total, currency, stage: 'Won', origin: 'running_deal', created_by: profile.id }).select('id').single()
    if (pe || !proposal) throw new ApiError(400, pe?.message ?? 'Could not create the deal')
    const fail = async (what: string, msg: string | undefined): Promise<never> => {
      await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'running_deal_incomplete', entityType: 'proposal', entityId: proposal.id, after: { failed_at: what, error: msg } })
      throw new ApiError(500, `The deal was only partly created (it stopped at: ${what}). Proposal ${proposal.id} exists — tell an administrator rather than entering it again.`)
    }
    const { error: le } = await svc.from('proposal_lines').insert(items.map((x) => ({ org_id: profile.org_id, proposal_id: proposal.id, item_id: x.item_id, quantity: 1, sell_price: x.sell_price, created_by: profile.id })))
    if (le) await fail('lines', le.message)
    await svc.from('proposal_stage_history').insert({ org_id: profile.org_id, proposal_id: proposal.id, from_stage: null, to_stage: 'Won', reason: 'Entered as a deal that was already running', changed_by: profile.id })
    const { data: deal, error: de } = await svc.from('deals').insert({ org_id: profile.org_id, proposal_id: proposal.id }).select('id').single()
    if (de || !deal) await fail('deal', de?.message)
    const { data: contract, error: ce } = await svc.from('contracts').insert({ org_id: profile.org_id, deal_id: deal!.id, terms: b.terms ?? null, final_amount: total, currency, renewal_date: b.renewal_date, booked_on: b.signed_on ?? null, created_by: profile.id }).select('id').single()
    if (ce || !contract) await fail('contract', ce?.message)
    let project
    try { project = await ensureProject(profile.org_id, deal!.id, profile.id) } catch (e) { await fail('project', e instanceof Error ? e.message : String(e)) }
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'running_deal_entered', entityType: 'project', entityId: project!.id, after: { proposal_id: proposal.id, deal_id: deal!.id, contract_id: contract!.id, final_amount: total, currency, items: items.length, at: now } })
    return NextResponse.json({ project_id: project!.id, proposal_id: proposal.id, deal_id: deal!.id, contract_id: contract!.id, final_amount: total, currency }, { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
