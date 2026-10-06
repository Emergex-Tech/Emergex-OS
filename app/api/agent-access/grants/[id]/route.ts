import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { isUuid } from '@/lib/ids'
import { parseGrantFields } from '@/lib/grantFields'
import { errorResponse } from '@/lib/apiError'

async function loadGrant(orgId: string, id: string) {
  if (!isUuid(id)) throw new ApiError(404, 'Grant not found')
  const { data } = await supabaseService().from('shareable_grants').select('id, agent_id, revoked_at').eq('id', id).eq('org_id', orgId).maybeSingle()
  if (!data) throw new ApiError(404, 'Grant not found')
  return data
}

/** Edit the white-label title or the indicative price of an ACTIVE grant. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'agent.share.manage')
    const grant = await loadGrant(profile.org_id, params.id)
    if (grant.revoked_at) throw new ApiError(400, 'This grant has been revoked')
    const fields = parseGrantFields(await req.json().catch(() => ({})))
    if (Object.keys(fields).length === 0) throw new ApiError(400, 'Nothing to change')
    const { data, error } = await supabaseService().from('shareable_grants').update(fields).eq('id', params.id).eq('org_id', profile.org_id).select('id, display_title, indicative_price, price_currency').single()
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'agent_grant_updated', entityType: 'agent', entityId: grant.agent_id, after: fields })
    return NextResponse.json(data)
  } catch (err) { return errorResponse(err) }
}

/** Revoke: soft (kept for the audit trail) and immediate — the agent's very next request gets a 404 for it. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'agent.share.manage')
    const grant = await loadGrant(profile.org_id, params.id)
    if (grant.revoked_at) throw new ApiError(400, 'Already revoked')
    const { error } = await supabaseService().from('shareable_grants').update({ revoked_at: new Date().toISOString(), revoked_by: profile.id }).eq('id', params.id).eq('org_id', profile.org_id)
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'agent_grant_revoked', entityType: 'agent', entityId: grant.agent_id })
    return NextResponse.json({ ok: true })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
