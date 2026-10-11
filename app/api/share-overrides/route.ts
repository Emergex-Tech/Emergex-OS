import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

/** The review queue for share-conflict overrides. Any internal role can see it; only approvers can act (enforced on approve/reject). */
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const status = req.nextUrl.searchParams.get('status') ?? 'pending'
    const svc = supabaseService()
    const { data, error } = await svc
      .from('share_conflict_overrides')
      .select('id, proposal_id, conflict_types, conflicts, reason, status, created_at, items(name), brands(name), requester:profiles!requested_by(full_name)')
      .eq('org_id', profile.org_id).eq('status', status).order('created_at', { ascending: true })
    if (error) throw new ApiError(400, error.message)
    return NextResponse.json(data ?? [])
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
