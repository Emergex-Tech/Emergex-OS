import { NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { hasPermission } from '@/lib/serviceLayer'
import { buildPipeline } from '@/lib/pipeline'
import { errorResponse } from '@/lib/apiError'

/** A27. Every internal role can view the pipeline; net margin is only included for margin.view holders. */
export async function GET() {
  try {
    const profile = await requireProfile()
    const canViewMargin = await hasPermission(profile, 'margin.view')
    const pipeline = await buildPipeline(profile.org_id, canViewMargin)
    return NextResponse.json(pipeline)
  } catch (err) {
    return errorResponse(err)
  }
}

export const dynamic = 'force-dynamic'
