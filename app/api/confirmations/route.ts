import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'
import { nextReconfirmationDate, resolveActiveOverride } from '@/lib/categories'
import type { Category, ReconfirmationOverride } from '@/types/db'

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    const entityType = body.entity_type as 'property' | 'item' | 'route'
    const entityId = body.entity_id as string
    if (!entityType || !entityId) throw new ApiError(400, 'entity_type and entity_id are required')

    await requirePermission(profile, 'record.update')
    const svc = supabaseService()

    await svc.from('confirmations').insert({
      org_id: profile.org_id, entity_type: entityType, entity_id: entityId, confirmed_by: profile.id
    })

    if (entityType === 'route') {
      // Routes just get is_stale cleared elsewhere (route review is 90-day flat,
      // handled the same way as '90day' category items) — no category lookup needed.
      await svc.from('routes').update({ updated_at: new Date().toISOString() }).eq('id', entityId).eq('org_id', profile.org_id)
      await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'confirm', entityType, entityId })
      return NextResponse.json({ ok: true })
    }

    const table = entityType === 'property' ? 'properties' : 'items'
    const { data: record } = await svc.from(table).select('*').eq('id', entityId).single()
    if (!record) throw new ApiError(404, 'Record not found')

    const propertyId = entityType === 'property' ? entityId : record.property_id
    const { data: property } = await svc.from('properties').select('category_key, event_start').eq('id', propertyId).single()
    if (!property) throw new ApiError(404, 'Property not found for this record')
    const { data: categoryRow } = await svc.from('categories').select('*').eq('key', property.category_key).single()
    const category = categoryRow as Category

    const { data: itemOverride } = entityType === 'item'
      ? await svc.from('reconfirmation_overrides').select('*').eq('entity_type', 'item').eq('entity_id', entityId).eq('status', 'active').maybeSingle()
      : { data: null }
    const { data: propertyOverride } = await svc.from('reconfirmation_overrides').select('*').eq('entity_type', 'property').eq('entity_id', propertyId).eq('status', 'active').maybeSingle()

    const activeOverride = resolveActiveOverride(itemOverride as ReconfirmationOverride | null, propertyOverride as ReconfirmationOverride | null)

    const due = nextReconfirmationDate({
      category,
      lastConfirmedAt: new Date(),
      eventStart: property.event_start ? new Date(property.event_start) : null,
      activeOverride
    })

    await svc.from(table).update({
      is_stale: false,
      next_reconfirmation_at: due.toISOString().slice(0, 10)
    }).eq('id', entityId).eq('org_id', profile.org_id)

    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'confirm', entityType, entityId, after: { next_reconfirmation_at: due } })

    return NextResponse.json({ ok: true, next_reconfirmation_at: due })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
