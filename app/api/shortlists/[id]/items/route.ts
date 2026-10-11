import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadOwned } from '@/lib/workspace'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

const MAX_ITEMS = 200

/** Add items to YOUR shortlist. Idempotent: an item already on it is reported, not duplicated. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    await loadOwned('shortlists', profile.org_id, profile.id, params.id)
    const body = await req.json().catch(() => ({}))
    const ids = Array.from(new Set((Array.isArray(body.item_ids) ? body.item_ids : []).filter(isUuid))) as string[]
    if (ids.length === 0) throw new ApiError(400, 'Choose at least one item')
    const svc = supabaseService()
    const { data: found } = await svc.from('items').select('id').in('id', ids).eq('org_id', profile.org_id)
    if ((found ?? []).length !== ids.length) throw new ApiError(400, 'One or more items do not exist')
    const { data: existing } = await svc.from('shortlist_items').select('item_id').eq('shortlist_id', params.id)
    const have = new Set((existing ?? []).map((e) => e.item_id))
    const toAdd = ids.filter((i) => !have.has(i))
    if (have.size + toAdd.length > MAX_ITEMS) throw new ApiError(400, `A shortlist can hold at most ${MAX_ITEMS} items`)
    if (toAdd.length) {
      const { error } = await svc.from('shortlist_items').insert(toAdd.map((item_id) => ({ shortlist_id: params.id, item_id, org_id: profile.org_id, added_by: profile.id })))
      if (error) throw new ApiError(400, error.message)
      await svc.from('shortlists').update({ updated_at: new Date().toISOString() }).eq('id', params.id)
    }
    return NextResponse.json({ added: toAdd.length, already_there: ids.length - toAdd.length }, { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
