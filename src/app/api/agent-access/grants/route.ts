import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { isUuid } from '@/lib/ids'
import { parseGrantFields } from '@/lib/grantFields'
import { errorResponse } from '@/lib/apiError'

export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'agent.share.manage')
    const agentId = req.nextUrl.searchParams.get('agent_id')
    if (!isUuid(agentId)) throw new ApiError(400, 'agent_id is required')
    let q = supabaseService().from('shareable_grants')
      .select('id, display_title, indicative_price, price_currency, granted_at, revoked_at, items(name, availability, properties(name))')
      .eq('org_id', profile.org_id).eq('agent_id', agentId).order('granted_at', { ascending: false })
    if (req.nextUrl.searchParams.get('include_revoked') !== '1') q = q.is('revoked_at', null)
    const { data, error } = await q
    if (error) throw new ApiError(400, error.message)
    return NextResponse.json(data ?? [])
  } catch (err) { return errorResponse(err) }
}

/** B13: mark items shareable with ONE agent company — by item ids, or every item currently in a property. */
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'agent.share.manage')
    const body = await req.json().catch(() => ({}))
    if (!isUuid(body.agent_id)) throw new ApiError(400, 'agent_id is required')
    const svc = supabaseService()
    const { data: agent } = await svc.from('agents').select('id').eq('id', body.agent_id).eq('org_id', profile.org_id).maybeSingle()
    if (!agent) throw new ApiError(400, 'That agent does not exist')

    const ids = new Set<string>((Array.isArray(body.item_ids) ? body.item_ids : []).filter(isUuid))
    if (body.property_id != null) {
      if (!isUuid(body.property_id)) throw new ApiError(400, 'property_id is not valid')
      const { data } = await svc.from('items').select('id').eq('property_id', body.property_id).eq('org_id', profile.org_id)
      for (const i of data ?? []) ids.add(i.id)
    }
    if (ids.size === 0) throw new ApiError(400, 'Choose at least one item')
    if (ids.size > 200) throw new ApiError(400, 'At most 200 items at a time')

    const fields = parseGrantFields(body)
    if (ids.size > 1 && (fields.display_title || fields.indicative_price != null)) {
      throw new ApiError(400, 'A display title or price can only be set when sharing ONE item — set them per item afterwards')
    }
    const itemIds = Array.from(ids)
    const { data: found } = await svc.from('items').select('id').in('id', itemIds).eq('org_id', profile.org_id)
    if ((found ?? []).length !== itemIds.length) throw new ApiError(400, 'One or more items do not exist')

    const { data: existing } = await svc.from('shareable_grants').select('item_id').eq('agent_id', body.agent_id).in('item_id', itemIds).is('revoked_at', null)
    const already = new Set((existing ?? []).map((e) => e.item_id))
    const toCreate = itemIds.filter((i) => !already.has(i))
    if (toCreate.length) {
      const { error } = await svc.from('shareable_grants').insert(toCreate.map((item_id) => ({
        org_id: profile.org_id, agent_id: body.agent_id, item_id, granted_by: profile.id, ...fields
      })))
      if (error) throw new ApiError(400, error.message)
    }
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'agent_grants_created', entityType: 'agent', entityId: body.agent_id, after: { created: toCreate.length, already_shared: already.size } })
    return NextResponse.json({ created: toCreate.length, already_shared: already.size }, { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
