import { NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { buildNotifications } from '@/lib/notifications'
import { errorResponse } from '@/lib/apiError'

/** Visible to every internal role — nothing in here is margin-adjacent, each item just links to a page RLS already scopes correctly. */
export async function GET() {
  try {
    const profile = await requireProfile()
    return NextResponse.json(await buildNotifications(profile.org_id))
  } catch (err) {
    return errorResponse(err)
  }
}

export const dynamic = 'force-dynamic'
