import { NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { buildNotifications } from '@/lib/notifications'
import { hasPermission } from '@/lib/serviceLayer'
import { errorResponse } from '@/lib/apiError'

/** Every internal role gets the operational groups; money groups (overdue invoices/payables) only come back for finance.manage holders. */
export async function GET() {
  try {
    const profile = await requireProfile()
    return NextResponse.json(await buildNotifications(profile.org_id, { finance: await hasPermission(profile, 'finance.manage') }))
  } catch (err) {
    return errorResponse(err)
  }
}

export const dynamic = 'force-dynamic'
