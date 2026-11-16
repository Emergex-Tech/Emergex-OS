import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, hasPermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

/**
 * Lists reconfirmation overrides for review — defaults to pending (the
 * review-queue use case). entity_type/entity_id is polymorphic (property |
 * item | route), so there's no single join Postgres can do here — this
 * resolves each entity's display name with a couple of follow-up queries
 * instead of N+1-ing per row.
 */
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const status = req.nextUrl.searchParams.get('status') ?? 'pending'
    const svc = supabaseService()

    const { data: overrides, error } = await svc
      .from('reconfirmation_overrides')
      .select('*')
      .eq('org_id', profile.org_id)
      .eq('status', status)
      .order('created_at', { ascending: true })
    if (error) throw new ApiError(400, error.message)

    const propertyIds = (overrides ?? []).filter((o) => o.entity_type === 'property').map((o) => o.entity_id)
    const itemIds = (overrides ?? []).filter((o) => o.entity_type === 'item').map((o) => o.entity_id)
    const routeIds = (overrides ?? []).filter((o) => o.entity_type === 'route').map((o) => o.entity_id)

    const [properties, items, routes] = await Promise.all([
      propertyIds.length ? svc.from('properties').select('id, name').in('id', propertyIds) : { data: [] },
      itemIds.length ? svc.from('items').select('id, name').in('id', itemIds) : { data: [] },
      routeIds.length ? svc.from('routes').select('id, market, brands(name)').in('id', routeIds) : { data: [] }
    ])

    const nameFor = (entityType: string, entityId: string): string => {
      if (entityType === 'property') return properties.data?.find((p) => p.id === entityId)?.name ?? entityId
      if (entityType === 'item') return items.data?.find((i) => i.id === entityId)?.name ?? entityId
      if (entityType === 'route') {
        const r = routes.data?.find((r) => r.id === entityId) as unknown as { market: string; brands: { name: string } } | undefined
        return r ? `${r.brands?.name ?? '?'} (${r.market ?? '—'})` : entityId
      }
      return entityId
    }

    const enriched = (overrides ?? []).map((o) => ({ ...o, entity_name: nameFor(o.entity_type, o.entity_id) }))
    return NextResponse.json(enriched)
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    const { entity_type, entity_id, period_days, reason, direction } = body

    if (!entity_type || !entity_id || !period_days || !reason || !direction) {
      throw new ApiError(400, 'entity_type, entity_id, period_days, reason and direction are required')
    }
    if (!['shorten', 'lengthen'].includes(direction)) throw new ApiError(400, "direction must be 'shorten' or 'lengthen'")

    await requirePermission(profile, 'override.set')
    const svc = supabaseService()

    // PRD 6.5: "Shortening applies at once; lengthening waits for Management approval."
    // "Management approval" means whichever role holds override.lengthen.approve —
    // originally 'management', now 'manager'/'ceo' post-split — checked by
    // permission, not by comparing profile.role_key to a specific role name.
    const canSelfApprove = direction === 'shorten' || (await hasPermission(profile, 'override.lengthen.approve'))
    const status = canSelfApprove ? 'active' : 'pending'

    const { data: override, error } = await svc.from('reconfirmation_overrides').insert({
      org_id: profile.org_id,
      entity_type, entity_id, period_days, reason, direction,
      status,
      set_by: profile.id,
      approved_by: status === 'active' ? profile.id : null
    }).select().single()

    if (error) throw new ApiError(400, error.message)

    await writeAudit({
      orgId: profile.org_id, actorId: profile.id, action: 'override', entityType: entity_type, entityId: entity_id, after: override
    })

    return NextResponse.json(override, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
