import { requireProfile, ApiError } from './auth'
import { requirePermission } from './serviceLayer'
import { supabaseService } from './supabaseServer'
import type { Profile } from '@/types/db'

/**
 * PRD 6.16: the agent portal is "released only after a security review". That is a human step this
 * code cannot perform, so the portal is OFF until someone deliberately sets AGENT_ACCESS_ENABLED=1.
 * Agent accounts can be created while it's off (to prepare); they just can't use any data route.
 */
export const agentAccessEnabled = (): boolean => ['1', 'true', 'yes'].includes((process.env.AGENT_ACCESS_ENABLED ?? '').toLowerCase())

export interface AgentContext { profile: Profile; agentId: string; agentName: string }

/** The single gate for every /api/agent/* route: an external agent user, with a company, with the portal released. */
export async function requireAgent(): Promise<AgentContext> {
  const profile = await requireProfile({ allowExternal: true })
  if (!profile.is_external || profile.role_key !== 'agent' || !profile.agent_id) throw new ApiError(403, 'This area is for agents only')
  if (!agentAccessEnabled()) throw new ApiError(403, 'The agent portal has not been released yet')
  await requirePermission(profile, 'agent.portal.use')
  const { data: agent } = await supabaseService().from('agents').select('name').eq('id', profile.agent_id).eq('org_id', profile.org_id).single()
  if (!agent) throw new ApiError(403, 'Your agent company could not be found')
  return { profile, agentId: profile.agent_id, agentName: agent.name }
}

/**
 * B17: every agent view is logged — and it FAILS CLOSED: callers log BEFORE returning data, and if the
 * log write fails the request fails, so there is no way to read inventory without it being recorded.
 */
export async function logAgentActivity(ctx: AgentContext, action: 'view_inventory' | 'view_item' | 'submit_intel' | 'view_intel', itemId?: string | null) {
  const { error } = await supabaseService().from('agent_activity').insert({
    org_id: ctx.profile.org_id, agent_id: ctx.agentId, user_id: ctx.profile.id, action, item_id: itemId ?? null
  })
  if (error) throw new ApiError(500, 'Could not record this view, so it was not shown')
}
