import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { parseCriteria } from '@/lib/benchmarks'
import { cleanName, loadOwned, isUniqueViolation, plainObject } from '@/lib/workspace'
import { errorResponse } from '@/lib/apiError'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    await loadOwned('saved_filters', profile.org_id, profile.id, params.id)
    const body = await req.json().catch(() => ({}))
    const patch: Record<string, unknown> = {}
    if ('name' in body) patch.name = cleanName(body.name)
    if ('shared' in body) patch.shared = body.shared === true
    if ('criteria' in body) { const p = parseCriteria(plainObject(body.criteria)); if (!p.ok) throw new ApiError(400, p.error); patch.criteria = p.criteria }
    if (Object.keys(patch).length === 0) throw new ApiError(400, 'Nothing to change')
    const { data, error } = await supabaseService().from('saved_filters').update(patch).eq('id', params.id).select('id, name, criteria, shared').single()
    if (isUniqueViolation(error)) throw new ApiError(409, 'You already have a saved filter with that name')
    if (error) throw new ApiError(400, error.message)
    return NextResponse.json(data)
  } catch (err) { return errorResponse(err) }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    await loadOwned('saved_filters', profile.org_id, profile.id, params.id)
    const { error } = await supabaseService().from('saved_filters').delete().eq('id', params.id)
    if (error) throw new ApiError(400, error.message)
    return NextResponse.json({ ok: true })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
