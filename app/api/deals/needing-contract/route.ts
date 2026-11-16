import { NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

/** Won deals with no contract yet — what the "New contract" picker on /contracts offers. */
export async function GET() {
  try {
    const profile = await requireProfile()
    const svc = supabaseService()
    const { data: deals, error } = await svc.from('deals').select('id, proposals(brands(name))').eq('org_id', profile.org_id)
    if (error) throw new ApiError(400, error.message)

    const { data: existingContracts } = await svc.from('contracts').select('deal_id').eq('org_id', profile.org_id)
    const contractedDealIds = new Set((existingContracts ?? []).map((c) => c.deal_id))

    return NextResponse.json(
      (deals ?? [])
        .filter((d) => !contractedDealIds.has(d.id))
        .map((d) => ({ deal_id: d.id, brand_name: (d.proposals as unknown as { brands: { name: string } } | null)?.brands?.name ?? '' }))
    )
  } catch (err) {
    return errorResponse(err)
  }
}

export const dynamic = 'force-dynamic'
