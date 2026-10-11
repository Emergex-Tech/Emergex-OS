import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { parseCriteria } from '@/lib/benchmarks'
import { cleanName, isUniqueViolation, plainObject } from '@/lib/workspace'
import { errorResponse } from '@/lib/apiError'

const MAX_PER_USER = 100

export async function GET() {
  try {
    const profile = await requireProfile()
    const { data, error } = await supabaseService().from('saved_filters').select('id, name, criteria, shared, owner_id, created_at, profiles(full_name)')
      .eq('org_id', profile.org_id).or(`owner_id.eq.${profile.id},shared.eq.true`).order('name')
    if (error) throw new ApiError(400, error.message)
    return NextResponse.json((data ?? []).map((f) => ({ id: f.id, name: f.name, criteria: f.criteria, shared: f.shared, mine: f.owner_id === profile.id, owner: (f.profiles as unknown as { full_name: string } | null)?.full_name ?? null })))
  } catch (err) { return errorResponse(err) }
}

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.create')
    const body = await req.json().catch(() => ({}))
    const name = cleanName(body.name)
    const parsed = parseCriteria(plainObject(body.criteria))
    if (!parsed.ok) throw new ApiError(400, parsed.error)
    const svc = supabaseService()
    const mine = await svc.from('saved_filters').select('id', { count: 'exact', head: true }).eq('owner_id', profile.id)
    if ((mine.count ?? 0) >= MAX_PER_USER) throw new ApiError(400, `You can keep at most ${MAX_PER_USER} saved filters`)
    const { data, error } = await svc.from('saved_filters').insert({ org_id: profile.org_id, owner_id: profile.id, name, criteria: parsed.criteria, shared: body.shared === true }).select('id, name, criteria, shared').single()
    if (isUniqueViolation(error)) throw new ApiError(409, 'You already have a saved filter with that name')
    if (error) throw new ApiError(400, error.message)
    return NextResponse.json({ ...data, mine: true }, { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
