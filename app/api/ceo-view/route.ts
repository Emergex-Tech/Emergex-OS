import { NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { buildCeoViewSummary } from '@/lib/ceoView'
import { errorResponse } from '@/lib/apiError'

/** A33. ceo_view.access is held only by CEO (and legacy 'management') — NOT Manager, per the additive role design. */
export async function GET() {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'ceo_view.access')
    return NextResponse.json(await buildCeoViewSummary(profile.org_id))
  } catch (err) {
    return errorResponse(err)
  }
}

export const dynamic = 'force-dynamic'
