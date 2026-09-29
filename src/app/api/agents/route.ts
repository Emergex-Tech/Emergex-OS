import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { createRecord } from '@/lib/serviceLayer'
import { errorResponse } from '@/lib/apiError'

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    if (!body.name) throw new ApiError(400, 'name is required')

    const agent = await createRecord({
      profile,
      permission: 'record.create',
      table: 'agents',
      entityType: 'agent',
      data: { name: body.name, markets: body.markets ?? null },
      driveFolder: { entityType: 'agent', nameField: 'name' }
    })

    return NextResponse.json(agent, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
