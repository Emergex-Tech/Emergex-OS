import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

/** L24: the project repository. Approved case studies by default, filterable by brand, category, market, property and free text. Staff only. */
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const sp = req.nextUrl.searchParams
    const status = sp.get('status') ?? 'approved'
    if (!['approved', 'draft', 'all'].includes(status)) throw new ApiError(400, "status must be 'approved', 'draft' or 'all'")
    let q = supabaseService().from('case_studies')
      .select('id, project_id, status, title, anonymised_title, brand_name, category_keys, markets, property_names, results, delivery_pct, named_use_approved, approved_at, updated_at')
      .eq('org_id', profile.org_id).order('approved_at', { ascending: false, nullsFirst: false }).order('updated_at', { ascending: false }).limit(500)
    if (status !== 'all') q = q.eq('status', status)
    const { data, error } = await q
    if (error) throw new ApiError(500, error.message)
    const has = (xs: string[], v: string | null) => !v || xs.some((x) => x.toLowerCase() === v.trim().toLowerCase())
    const text = (sp.get('q') ?? '').trim().toLowerCase(), brand = (sp.get('brand') ?? '').trim().toLowerCase()
    const rows = (data ?? []).filter((s) =>
      has(s.category_keys ?? [], sp.get('category')) && has(s.markets ?? [], sp.get('market')) && has(s.property_names ?? [], sp.get('property')) &&
      (!brand || s.brand_name.toLowerCase().includes(brand)) &&
      (!text || `${s.title} ${s.brand_name} ${(s.property_names ?? []).join(' ')}`.toLowerCase().includes(text)))
    return NextResponse.json(rows)
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
