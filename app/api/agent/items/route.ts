import { NextResponse } from 'next/server'
import { requireAgent, logAgentActivity } from '@/lib/agentAccess'
import { supabaseService } from '@/lib/supabaseServer'
import { toAgentItemView, type GrantRow, type ItemRow } from '@/lib/agentView'
import { ApiError } from '@/lib/auth'
import { errorResponse } from '@/lib/apiError'

const GRANT_SELECT = 'id, display_title, indicative_price, price_currency, items(name, availability, offer_expiry, attributes, properties(name, market, event_start, event_end, attributes, categories(label)))'

/** B14: the items explicitly shared with THIS agent's company, through the allow-list view. Logged before it is returned. */
export async function GET() {
  try {
    const ctx = await requireAgent()
    const { data, error } = await supabaseService().from('shareable_grants').select(GRANT_SELECT)
      .eq('org_id', ctx.profile.org_id).eq('agent_id', ctx.agentId).is('revoked_at', null).order('granted_at', { ascending: false })
    if (error) throw new ApiError(500, 'Could not load your inventory')
    await logAgentActivity(ctx, 'view_inventory')
    return NextResponse.json((data ?? []).map((g) => toAgentItemView(g as unknown as GrantRow, (g as unknown as { items: ItemRow }).items)))
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
