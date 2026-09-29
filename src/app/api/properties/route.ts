import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { createRecord } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const body = await req.json()

    if (!body.name || !body.category_key) {
      throw new ApiError(400, 'name and category_key are required')
    }

    const property = await createRecord({
      profile,
      permission: 'record.create',
      table: 'properties',
      entityType: 'property',
      data: {
        category_key: body.category_key,
        vendor_id: body.vendor_id ?? null,
        name: body.name,
        market: body.market ?? null,
        event_start: body.event_start ?? null,
        event_end: body.event_end ?? null,
        attributes: body.attributes ?? {},
        delivery_side_agent_id: body.delivery_side_agent_id ?? null
      },
      duplicateCheck: { entityType: 'property', nameField: 'name' },
      driveFolder: { entityType: 'property', nameField: 'name' }
    })

    // Entering a record counts as its first confirmation (PRD 6.5).
    const svc = supabaseService()
    await svc.from('confirmations').insert({
      org_id: profile.org_id,
      entity_type: 'property',
      entity_id: property.id,
      confirmed_by: profile.id
    })

    return NextResponse.json(property, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
