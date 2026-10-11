import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { createRecord } from '@/lib/serviceLayer'
import { errorResponse } from '@/lib/apiError'

const VALID_TYPES = ['rack', 'quote', 'negotiated', 'transacted', 'market_intel']

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const body = await req.json()

    if (!body.item_id || !body.type) throw new ApiError(400, 'item_id and type are required')
    if (!VALID_TYPES.includes(body.type)) throw new ApiError(400, `type must be one of ${VALID_TYPES.join(', ')}`)

    const record = await createRecord({
      profile,
      permission: 'price.record_cost',
      table: 'price_records',
      entityType: 'price_record',
      data: {
        item_id: body.item_id,
        type: body.type,
        amount: body.amount ?? null,
        currency: body.currency ?? 'USD',
        unit: body.unit ?? null,
        price_date: body.price_date ?? new Date().toISOString().slice(0, 10),
        validity_days: body.validity_days ?? null,
        days_to_event: body.days_to_event ?? null,
        source: body.source ?? null,
        brand_id: body.brand_id ?? null,
        route_id: body.route_id ?? null,
        reusable: body.reusable ?? false
      }
    })

    return NextResponse.json(record, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
