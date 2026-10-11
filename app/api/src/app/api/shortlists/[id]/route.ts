import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { cleanName, loadOwned, isUniqueViolation } from '@/lib/workspace'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    if (!isUuid(params.id)) throw new ApiError(404, 'Not found')
    const svc = supabaseService()
    const { data: list } = await svc.from('shortlists').select('id, name, note, shared, owner_id').eq('id', params.id).eq('org_id', profile.org_id).maybeSingle()
    if (!list || (list.owner_id !== profile.id && !list.shared)) throw new ApiError(404, 'Not found')
    const { data: items, error } = await svc.from('shortlist_items')
      .select('item_id, added_at, items(name, availability, is_stale, properties(name, market, vendors(name), categories(label)))').eq('shortlist_id', params.id).order('added_at')
    if (error) throw new ApiError(400, error.message)
    return NextResponse.json({ id: list.id, name: list.name, note: list.note, shared: list.shared, mine: list.owner_id === profile.id, items: items ?? [] })
  } catch (err) { return errorResponse(err) }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    await loadOwned('shortlists', profile.org_id, profile.id, params.id)
    const body = await req.json().catch(() => ({}))
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('name' in body) patch.name = cleanName(body.name)
    if ('note' in body) patch.note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : null
    if ('shared' in body) patch.shared = body.shared === true
    if (Object.keys(patch).length === 1) throw new ApiError(400, 'Nothing to change')
    const { data, error } = await supabaseService().from('shortlists').update(patch).eq('id', params.id).select('id, name, note, shared').single()
    if (isUniqueViolation(error)) throw new ApiError(409, 'You already have a shortlist with that name')
    if (error) throw new ApiError(400, error.message)
    return NextResponse.json(data)
  } catch (err) { return errorResponse(err) }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    await loadOwned('shortlists', profile.org_id, profile.id, params.id)
    const { error } = await supabaseService().from('shortlists').delete().eq('id', params.id)
    if (error) throw new ApiError(400, error.message)
    return NextResponse.json({ ok: true })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
