import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

/** B16, staff side: agent-submitted notes awaiting review (default), or already reviewed/declined. */
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'agent.intel.review')
    const status = req.nextUrl.searchParams.get('status') ?? 'pending'
    if (!['pending', 'reviewed', 'rejected'].includes(status)) throw new ApiError(400, 'status must be pending, reviewed or rejected')
    const svc = supabaseService()
    const { data, error } = await svc.from('intel_notes')
      .select('id, note, created_at, review_status, reliability, claimed_price, claimed_currency, linked_type, linked_id, agents(name)')
      .eq('org_id', profile.org_id).not('submitted_by_agent_id', 'is', null).eq('review_status', status).order('created_at', { ascending: true }).limit(200)
    if (error) throw new ApiError(400, error.message)
    const itemIds = (data ?? []).filter((n) => n.linked_type === 'item' && n.linked_id).map((n) => n.linked_id as string)
    const { data: items } = itemIds.length ? await svc.from('items').select('id, name').in('id', itemIds) : { data: [] as { id: string; name: string }[] }
    const nameById = new Map((items ?? []).map((i) => [i.id, i.name]))
    return NextResponse.json((data ?? []).map((n) => ({ ...n, item_name: n.linked_id ? nameById.get(n.linked_id) ?? null : null })))
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
