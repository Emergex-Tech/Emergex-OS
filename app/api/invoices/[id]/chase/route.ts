import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { listInvoices } from '@/lib/finance'
import { errorResponse } from '@/lib/apiError'

/** B10: log that someone chased this invoice. Only an overdue one can be chased. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'finance.manage')
    const body = await req.json().catch(() => ({}))
    const [inv] = await listInvoices(profile.org_id, { id: params.id })
    if (!inv) throw new ApiError(404, 'Invoice not found')
    if (!inv.overdue) throw new ApiError(400, 'Only an overdue invoice can be chased')
    const { error } = await supabaseService().from('invoice_chases').insert({ org_id: profile.org_id, invoice_id: params.id, note: body.note ?? null, chased_by: profile.id })
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'invoice_chased', entityType: 'invoice', entityId: params.id })
    const [updated] = await listInvoices(profile.org_id, { id: params.id })
    return NextResponse.json(updated, { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
