import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { cleanName, isUniqueViolation } from '@/lib/workspace'
import { errorResponse } from '@/lib/apiError'

const MAX_PER_USER = 50

export async function GET() {
  try {
    const profile = await requireProfile()
    const { data, error } = await supabaseService().from('shortlists').select('id, name, note, shared, owner_id, updated_at, shortlist_items(count), profiles(full_name)')
      .eq('org_id', profile.org_id).or(`owner_id.eq.${profile.id},shared.eq.true`).order('name')
    if (error) throw new ApiError(400, error.message)
    return NextResponse.json((data ?? []).map((s) => ({
      id: s.id, name: s.name, note: s.note, shared: s.shared, mine: s.owner_id === profile.id, updated_at: s.updated_at,
      item_count: (s.shortlist_items as unknown as { count: number }[] | null)?.[0]?.count ?? 0, owner: (s.profiles as unknown as { full_name: string } | null)?.full_name ?? null
    })))
  } catch (err) { return errorResponse(err) }
}

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.create')
    const body = await req.json().catch(() => ({}))
    const name = cleanName(body.name)
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : null
    const svc = supabaseService()
    const mine = await svc.from('shortlists').select('id', { count: 'exact', head: true }).eq('owner_id', profile.id)
    if ((mine.count ?? 0) >= MAX_PER_USER) throw new ApiError(400, `You can keep at most ${MAX_PER_USER} shortlists`)
    const { data, error } = await svc.from('shortlists').insert({ org_id: profile.org_id, owner_id: profile.id, name, note, shared: body.shared === true }).select('id, name, note, shared').single()
    if (isUniqueViolation(error)) throw new ApiError(409, 'You already have a shortlist with that name')
    if (error) throw new ApiError(400, error.message)
    return NextResponse.json({ ...data, mine: true, item_count: 0 }, { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
