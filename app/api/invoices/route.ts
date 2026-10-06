import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { listInvoices } from '@/lib/finance'
import { errorResponse } from '@/lib/apiError'

export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'finance.manage')
    const direction = req.nextUrl.searchParams.get('direction') ?? undefined
    const contractId = req.nextUrl.searchParams.get('contract_id') ?? undefined
    return NextResponse.json(await listInvoices(profile.org_id, { direction, contractId }))
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
