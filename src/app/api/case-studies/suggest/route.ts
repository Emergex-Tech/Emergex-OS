import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { supabaseService } from '@/lib/supabaseServer'
import { rankCaseStudies } from '@/lib/caseStudy'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/**
 * L25: relevant past projects for a pitch. Give a proposal_id (its brand, categories, markets and properties are read from it)
 * or the filters by hand. Only APPROVED studies, and — D16 — the ANONYMISED text only, unless the brand has agreed to being named.
 * hidden_names is never returned.
 */
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const sp = req.nextUrl.searchParams
    const svc = supabaseService()
    let categories = sp.getAll('category_key'), markets = sp.getAll('market'), propertyNames = sp.getAll('property'), brandId: string | null = sp.get('brand_id')
    if (brandId && !isUuid(brandId)) throw new ApiError(400, 'brand_id is not valid')
    const proposalId = sp.get('proposal_id')
    if (proposalId) {
      if (!isUuid(proposalId)) throw new ApiError(404, 'Proposal not found')
      const { data: p } = await svc.from('proposals').select('brand_id, markets').eq('id', proposalId).eq('org_id', profile.org_id).maybeSingle()
      if (!p) throw new ApiError(404, 'Proposal not found')
      const { data: lines } = await svc.from('proposal_lines').select('items(properties(name, market, category_key))').eq('proposal_id', proposalId)
      const props = (lines ?? []).map((l) => (l.items as unknown as { properties: { name: string; market: string | null; category_key: string } | null } | null)?.properties).filter((x): x is { name: string; market: string | null; category_key: string } => !!x)
      categories = [...categories, ...props.map((x) => x.category_key)]
      markets = [...markets, ...props.map((x) => x.market ?? ''), ...String(p.markets ?? '').split(',')].map((m) => m.trim()).filter(Boolean)
      propertyNames = [...propertyNames, ...props.map((x) => x.name)]
      brandId = brandId ?? p.brand_id
    }
    const { data, error } = await svc.from('case_studies')
      .select('id, project_id, title, anonymised_title, anonymised_body, body, results, delivery_pct, category_keys, markets, property_names, brand_id, named_use_approved, approved_at')
      .eq('org_id', profile.org_id).eq('status', 'approved').limit(500)
    if (error) throw new ApiError(500, error.message)
    const ranked = rankCaseStudies(data ?? [], { categories, markets, propertyNames, brandId })
    return NextResponse.json({
      query: { categories: Array.from(new Set(categories)), markets: Array.from(new Set(markets)), properties: Array.from(new Set(propertyNames)) },
      suggestions: ranked.map(({ study: s, score, reasons }) => ({
        id: s.id, project_id: s.project_id, score, reasons, title: s.anonymised_title, text: s.anonymised_body, results: s.results, delivery_pct: s.delivery_pct, category_keys: s.category_keys, markets: s.markets, property_names: s.property_names,
        named_use_approved: s.named_use_approved, named: s.named_use_approved ? { title: s.title, text: s.body } : null
      }))
    })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
