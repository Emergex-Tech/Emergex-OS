import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'brand.tier.view')
    const svc = supabaseService()

    const { data } = await svc.from('brand_tier').select('*').eq('brand_id', params.id).maybeSingle()
    return NextResponse.json(data ?? { brand_id: params.id, tier: 'standard', margin_band_low: null, margin_band_high: null })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    await requirePermission(profile, 'brand.tier.set')
    const svc = supabaseService()

    const { data, error } = await svc.from('brand_tier').upsert({
      brand_id: params.id,
      org_id: profile.org_id,
      tier: body.tier ?? 'standard',
      margin_band_low: body.margin_band_low,
      margin_band_high: body.margin_band_high,
      set_by: profile.id,
      updated_at: new Date().toISOString()
    }, { onConflict: 'brand_id' }).select().single()

    if (error) throw new ApiError(400, error.message)
    return NextResponse.json(data)
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
