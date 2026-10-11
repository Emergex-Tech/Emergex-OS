import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadOwned } from '@/lib/workspace'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    await loadOwned('shortlists', profile.org_id, profile.id, params.id)
    if (!isUuid(params.itemId)) throw new ApiError(404, 'Not found')
    const { error, count } = await supabaseService().from('shortlist_items').delete({ count: 'exact' }).eq('shortlist_id', params.id).eq('item_id', params.itemId)
    if (error) throw new ApiError(400, error.message)
    if (!count) throw new ApiError(404, 'That item is not on this shortlist')
    return NextResponse.json({ ok: true })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
