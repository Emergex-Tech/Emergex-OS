import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/** B17: what agents have looked at, newest first. Append-only in the database. */
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'agent.share.manage')
    const agentId = req.nextUrl.searchParams.get('agent_id')
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') ?? 100) || 100, 1), 200)
    let q = supabaseService().from('agent_activity').select('id, action, created_at, items(name), profiles(full_name), agents(name)').eq('org_id', profile.org_id).order('created_at', { ascending: false }).limit(limit)
    if (agentId) { if (!isUuid(agentId)) throw new ApiError(400, 'agent_id is not valid'); q = q.eq('agent_id', agentId) }
    const { data, error } = await q
    if (error) throw new ApiError(400, error.message)
    return NextResponse.json(data ?? [])
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
