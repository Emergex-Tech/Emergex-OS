import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { supabaseService } from '@/lib/supabaseServer'
import { parseCriteria } from '@/lib/benchmarks'
import { errorResponse } from '@/lib/apiError'

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c)

/** Inventory search over the whitelisted filters (the same shape a saved filter stores). Unknown filters are refused, not ignored. */
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const raw: Record<string, unknown> = {}
    req.nextUrl.searchParams.forEach((v, k) => { raw[k] = v })
    const parsed = parseCriteria(raw)
    if (!parsed.ok) throw new ApiError(400, parsed.error)
    const c = parsed.criteria

    let q = supabaseService().from('items')
      .select('id, name, availability, is_stale, offer_expiry, properties!inner(id, name, market, category_key, vendor_id, vendors(name), categories(label))')
      .eq('org_id', profile.org_id).order('name').limit(500)
    if (c.category_key) q = q.eq('properties.category_key', c.category_key)
    if (c.market) q = q.ilike('properties.market', escapeLike(c.market))
    if (c.vendor_id) q = q.eq('properties.vendor_id', c.vendor_id)
    if (c.availability) q = q.eq('availability', c.availability)
    if (c.stale_only) q = q.eq('is_stale', true)
    const { data, error } = await q
    if (error) throw new ApiError(400, error.message)

    type P = { name: string; vendors: { name: string } | null }
    const needle = c.q?.toLowerCase()
    const rows = (data ?? []).filter((i) => !needle || `${i.name} ${(i.properties as unknown as P).name} ${(i.properties as unknown as P).vendors?.name ?? ''}`.toLowerCase().includes(needle))
    return NextResponse.json({ items: rows.slice(0, 200), truncated: rows.length > 200 || (data ?? []).length === 500, criteria: c })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
