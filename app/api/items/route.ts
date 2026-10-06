import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { createRecord } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    if (!body.property_id || !body.name) throw new ApiError(400, 'property_id and name are required')

    const item = await createRecord({
      profile,
      permission: 'record.create',
      table: 'items',
      entityType: 'item',
      data: {
        property_id: body.property_id,
        name: body.name,
        attributes: body.attributes ?? {},
        availability: body.availability ?? 'available',
        offer_expiry: body.offer_expiry ?? null
      }
    })

    const svc = supabaseService()
    await svc.from('confirmations').insert({
      org_id: profile.org_id, entity_type: 'item', entity_id: item.id, confirmed_by: profile.id
    })

    return NextResponse.json(item, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
