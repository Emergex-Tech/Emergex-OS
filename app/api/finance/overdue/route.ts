import { NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { listInvoices } from '@/lib/finance'
import { errorResponse } from '@/lib/apiError'

/** B10: everything overdue, most overdue first, with whether a chase reminder is due. */
export async function GET() {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'finance.manage')
    const all = await listInvoices(profile.org_id)
    return NextResponse.json(all.filter((i) => i.overdue).sort((a, b) => b.days_overdue - a.days_overdue))
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
