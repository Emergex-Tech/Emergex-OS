import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

const TYPES = ['brand', 'brand_group']

/** D8 as data: which brands/groups compete. Readable by all internal roles; only competitor.manage can change it. */
export async function GET() {
  try {
    const profile = await requireProfile()
    const svc = supabaseService()
    const [links, brands, groups] = await Promise.all([
      svc.from('competitor_links').select('id, a_type, a_id, b_type, b_id, note, created_at').eq('org_id', profile.org_id).order('created_at'),
      svc.from('brands').select('id, name').eq('org_id', profile.org_id),
      svc.from('brand_groups').select('id, name').eq('org_id', profile.org_id)
    ])
    if (links.error) throw new ApiError(400, links.error.message)
    const names = new Map<string, string>([
      ...(brands.data ?? []).map((b) => [`brand:${b.id}`, b.name] as [string, string]),
      ...(groups.data ?? []).map((g) => [`brand_group:${g.id}`, `${g.name} (group)`] as [string, string])
    ])
    return NextResponse.json((links.data ?? []).map((l) => ({
      ...l, a_name: names.get(`${l.a_type}:${l.a_id}`) ?? '(deleted)', b_name: names.get(`${l.b_type}:${l.b_id}`) ?? '(deleted)'
    })))
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'competitor.manage')
    const b = await req.json()
    if (!TYPES.includes(b.a_type) || !TYPES.includes(b.b_type) || !b.a_id || !b.b_id) throw new ApiError(400, 'a_type, a_id, b_type and b_id are required')
    if (b.a_type === b.b_type && b.a_id === b.b_id) throw new ApiError(400, 'A brand cannot compete with itself')

    const svc = supabaseService()
    for (const [type, id] of [[b.a_type, b.a_id], [b.b_type, b.b_id]]) {
      const table = type === 'brand' ? 'brands' : 'brand_groups'
      const { data } = await svc.from(table).select('id').eq('id', id).eq('org_id', profile.org_id).maybeSingle()
      if (!data) throw new ApiError(400, `That ${type.replace('_', ' ')} does not exist`)
    }
    const { data, error } = await svc.from('competitor_links')
      .insert({ org_id: profile.org_id, a_type: b.a_type, a_id: b.a_id, b_type: b.b_type, b_id: b.b_id, note: b.note ?? null, created_by: profile.id })
      .select().single()
    if (error) throw new ApiError(error.code === '23505' ? 409 : 400, error.code === '23505' ? 'These two are already marked as competitors' : error.message)

    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'create', entityType: 'competitor_link', entityId: data.id, after: data })
    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
