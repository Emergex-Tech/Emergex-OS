import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { supabaseService } from '@/lib/supabaseServer'
import { checkConflicts, overrideState } from '@/lib/conflicts'
import { errorResponse } from '@/lib/apiError'

/** Per-line conflict check for a proposal, plus where any override request for that line stands. Read-only. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const svc = supabaseService()
    const { data: proposal } = await svc.from('proposals').select('id, brand_id, route_id').eq('id', params.id).eq('org_id', profile.org_id).single()
    if (!proposal) throw new ApiError(404, 'Proposal not found')

    const { data: lines } = await svc.from('proposal_lines').select('id, item_id, items(name)').eq('proposal_id', params.id).order('created_at', { ascending: true })
    const result = await Promise.all((lines ?? []).map(async (l) => {
      const base = { orgId: profile.org_id, itemId: l.item_id, brandId: proposal.brand_id, routeId: proposal.route_id as string | null }
      const conflicts = await checkConflicts(base)
      return {
        line_id: l.id, item_id: l.item_id,
        item_name: (l.items as unknown as { name: string } | null)?.name ?? '',
        conflicts,
        override: conflicts.length ? await overrideState(base) : 'none'
      }
    }))
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
