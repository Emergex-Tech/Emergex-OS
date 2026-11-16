import { NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { buildWonLostAnalysis } from '@/lib/wonLost'
import { errorResponse } from '@/lib/apiError'

export async function GET() {
  try {
    const profile = await requireProfile()
    return NextResponse.json(await buildWonLostAnalysis(profile.org_id))
  } catch (err) {
    return errorResponse(err)
  }
}

export const dynamic = 'force-dynamic'
