import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

// PRD 4: "CEO: Final pricing authority, overrides, CEO view." This is that
// final layer — confirming the Manager-set price as-is, or overriding it
// with a reason. Both are logged; this endpoint doesn't recompute the
// stack itself (an override that changes numbers should go through
// /margin, which any margin.set holder — including CEO — can call; this
// endpoint is specifically for the confirm-or-flag-a-reason action).
export async function PATCH(req: NextRequest, { params }: { params: { lineId: string } }) {
  try {
    const profile = await requireProfile()
    const body = await req.json().catch(() => ({}))

    await requirePermission(profile, 'pricing.override') // CEO-only, per the additive role design
    const svc = supabaseService()

    const { data: line } = await svc.from('proposal_lines').select('id, sell_price').eq('id', params.lineId).eq('org_id', profile.org_id).single()
    if (!line) throw new ApiError(404, 'Proposal line not found')

    const { data: pricing } = await svc.from('proposal_line_pricing').select('*').eq('proposal_line_id', params.lineId).single()

    await svc.from('proposal_approvals').insert({
      org_id: profile.org_id,
      proposal_line_id: params.lineId,
      layer: 'ceo',
      action: body.reason ? 'overridden' : 'confirmed',
      snapshot: { sell_price: line.sell_price, margin_pct: pricing?.margin_pct, reason: body.reason ?? null },
      actor_id: profile.id
    })

    return NextResponse.json({ ok: true, action: body.reason ? 'overridden' : 'confirmed' })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
