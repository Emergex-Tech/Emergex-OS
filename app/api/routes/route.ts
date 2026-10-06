import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { createRecord } from '@/lib/serviceLayer'
import { errorResponse } from '@/lib/apiError'

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    if (!body.brand_id || !body.route_type) throw new ApiError(400, 'brand_id and route_type are required')

    // Initial strength/reliability on creation are allowed directly (not a "change"
    // to review) — PRD's pending-review flow applies to score CHANGES after creation.
    const route = await createRecord({
      profile,
      permission: 'record.create',
      table: 'routes',
      entityType: 'route',
      data: {
        brand_id: body.brand_id,
        route_type: body.route_type,
        agent_id: body.agent_id ?? null,
        contact_id: body.contact_id ?? null,
        contact_type: body.contact_type ?? null,
        market: body.market ?? null,
        description: body.description ?? null,
        strength: body.strength ?? null,
        reliability: body.reliability ?? null,
        status: 'active'
      }
    })

    return NextResponse.json(route, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
