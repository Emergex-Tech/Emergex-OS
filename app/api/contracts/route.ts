import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

/** B1: a contract per won deal, with final_amount derived from the proposal's own line totals — not re-entered by hand. */
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'contract.manage')
    const body = await req.json()
    if (!body.deal_id) throw new ApiError(400, 'deal_id is required')
    if (!body.renewal_date) throw new ApiError(400, 'renewal_date is required')

    const svc = supabaseService()
    const { data: deal } = await svc.from('deals').select('id, org_id, proposal_id').eq('id', body.deal_id).eq('org_id', profile.org_id).single()
    if (!deal) throw new ApiError(404, 'Deal not found')

    const { data: existing } = await svc.from('contracts').select('id').eq('deal_id', deal.id).maybeSingle()
    if (existing) throw new ApiError(409, 'This deal already has a contract')

    const { data: proposal } = await svc.from('proposals').select('currency').eq('id', deal.proposal_id).single()
    const { data: lines } = await svc.from('proposal_lines').select('sell_price, quantity').eq('proposal_id', deal.proposal_id)
    const finalAmount = (lines ?? []).reduce((sum, l) => sum + Number(l.sell_price) * Number(l.quantity), 0)

    const { data: contract, error } = await svc.from('contracts').insert({
      org_id: profile.org_id, deal_id: deal.id, terms: body.terms ?? null,
      final_amount: finalAmount, currency: proposal?.currency ?? 'USD', renewal_date: body.renewal_date,
      created_by: profile.id
    }).select().single()
    if (error) throw new ApiError(400, error.message)

    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'contract_created', entityType: 'contract', entityId: contract.id, after: { deal_id: deal.id, final_amount: finalAmount } })
    return NextResponse.json(contract, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function GET() {
  try {
    const profile = await requireProfile()
    const svc = supabaseService()
    const { data, error } = await svc
      .from('contracts')
      .select('id, renewal_date, status, final_amount, currency, created_at, deals(proposal_id, proposals(brands(name)))')
      .eq('org_id', profile.org_id)
      .order('renewal_date', { ascending: true, nullsFirst: false })
    if (error) throw new ApiError(400, error.message)

    return NextResponse.json((data ?? []).map((c) => ({
      id: c.id, renewal_date: c.renewal_date, status: c.status, final_amount: c.final_amount, currency: c.currency, created_at: c.created_at,
      brand_name: (c.deals as unknown as { proposals: { brands: { name: string } } })?.proposals?.brands?.name ?? ''
    })))
  } catch (err) {
    return errorResponse(err)
  }
}

export const dynamic = 'force-dynamic'
