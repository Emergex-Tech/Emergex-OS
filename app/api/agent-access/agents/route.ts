import { NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { agentAccessEnabled } from '@/lib/agentAccess'
import { errorResponse } from '@/lib/apiError'

/** Agent companies with their login users and how many items are currently shared with each. */
export async function GET() {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'agent.share.manage')
    const svc = supabaseService()
    const [agents, users, grants] = await Promise.all([
      svc.from('agents').select('id, name').eq('org_id', profile.org_id).order('name'),
      svc.from('profiles').select('id, full_name, email, disabled, agent_id').eq('org_id', profile.org_id).eq('role_key', 'agent'),
      svc.from('shareable_grants').select('agent_id').eq('org_id', profile.org_id).is('revoked_at', null)
    ])
    if (agents.error) throw new ApiError(400, agents.error.message)
    return NextResponse.json({
      portal_enabled: agentAccessEnabled(),
      agents: (agents.data ?? []).map((a) => ({
        id: a.id, name: a.name,
        users: (users.data ?? []).filter((u) => u.agent_id === a.id),
        active_grants: (grants.data ?? []).filter((g) => g.agent_id === a.id).length
      }))
    })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
