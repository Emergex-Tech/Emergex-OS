import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { createRecord } from '@/lib/serviceLayer'
import { errorResponse } from '@/lib/apiError'

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    if (!body.name) throw new ApiError(400, 'name is required')

    const vendor = await createRecord({
      profile,
      permission: 'record.create',
      table: 'vendors',
      entityType: 'vendor',
      data: {
        name: body.name,
        type: body.type ?? null,
        markets: body.markets ?? null,
        status: body.status ?? 'Recurring',
        owner_id: profile.id
      },
      duplicateCheck: { entityType: 'vendor', nameField: 'name' },
      driveFolder: { entityType: 'vendor', nameField: 'name' }
    })

    return NextResponse.json(vendor, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
