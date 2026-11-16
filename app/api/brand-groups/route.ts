import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { createRecord } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

export async function GET() {
  try {
    const profile = await requireProfile()
    const { data, error } = await supabaseService().from('brand_groups').select('id, name, brands(id, name)').eq('org_id', profile.org_id).order('name')
    if (error) throw new ApiError(400, error.message)
    return NextResponse.json(data ?? [])
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    if (!body.name?.trim()) throw new ApiError(400, 'name is required')
    const group = await createRecord({ profile, permission: 'record.create', table: 'brand_groups', entityType: 'brand_group', data: { name: body.name.trim() } })
    return NextResponse.json(group, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
