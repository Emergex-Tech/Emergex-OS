import { NextResponse } from 'next/server'
import { requireAgent, logAgentActivity } from '@/lib/agentAccess'
import { supabaseService } from '@/lib/supabaseServer'
import { toAgentItemView, type GrantRow, type ItemRow } from '@/lib/agentView'
import { isUuid } from '@/lib/ids'
import { ApiError } from '@/lib/auth'
import { errorResponse } from '@/lib/apiError'

const SELECT = 'id, item_id, display_title, indicative_price, price_currency, items(name, availability, offer_expiry, attributes, properties(name, market, event_start, event_end, attributes, categories(label)))'

/**
 * One shared item, addressed by its GRANT id. A grant that doesn't exist, belongs to another agent, or has been
 * revoked all give the SAME 404 — so probing ids can't reveal that an item exists or who it is shared with.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireAgent()
    if (!isUuid(params.id)) throw new ApiError(404, 'Not found')
    const { data } = await supabaseService().from('shareable_grants').select(SELECT)
      .eq('id', params.id).eq('org_id', ctx.profile.org_id).eq('agent_id', ctx.agentId).is('revoked_at', null).maybeSingle()
    if (!data) throw new ApiError(404, 'Not found')
    await logAgentActivity(ctx, 'view_item', (data as unknown as { item_id: string }).item_id)
    return NextResponse.json(toAgentItemView(data as unknown as GrantRow, (data as unknown as { items: ItemRow }).items))
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
