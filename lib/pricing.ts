import { supabaseService } from './supabaseServer'

export interface BestCost {
  amount: number
  currency: string
  unit: string | null
  type: string
  source: string | null
  priceRecordId: string
}

const COST_TYPE_PRIORITY = ['transacted', 'negotiated', 'quote', 'rack'] // market_intel excluded — never used as best valid cost, per PRD 6.6

export interface CostRecord {
  id: string
  type: string
  amount: number | string | null
  currency: string
  unit: string | null
  price_date: string
  validity_days: number | null
  source: string | null
  reusable: boolean | null
  brand_id: string | null
}

/**
 * Pure selection logic (kept separate from the DB read so it can be tested).
 *
 * PRD 6.6: "Best valid cost is shown per item... Market intel prices are shown but
 * never used as best valid cost." Picks the most authoritative still-valid record:
 * transacted > negotiated > quote > rack, most recent price_date within a type.
 * "Still valid" = no validity window, or price_date + validity_days hasn't passed.
 *
 * Negotiated rates "survive lost deals and stay usable, flagged by whether the
 * vendor will extend them to other brands" — so a negotiated record marked
 * reusable=false is only eligible for the brand it was negotiated for.
 */
export function pickBestCost(records: CostRecord[], brandId: string | null, today: Date = new Date()): BestCost | null {
  const eligible = records
    .filter((r) => r.type !== 'market_intel')
    .filter((r) => r.type !== 'negotiated' || r.reusable === true || (brandId != null && r.brand_id === brandId))
    .sort((a, b) => (a.price_date < b.price_date ? 1 : a.price_date > b.price_date ? -1 : 0)) // newest first

  if (eligible.length === 0) return null

  const stillValid = eligible.filter((r) => {
    if (!r.validity_days) return true
    const expiry = new Date(r.price_date)
    expiry.setDate(expiry.getDate() + r.validity_days)
    return expiry >= today
  })
  const pool = stillValid.length > 0 ? stillValid : eligible // fall back to full history rather than nothing

  for (const type of COST_TYPE_PRIORITY) {
    const match = pool.find((r) => r.type === type)
    if (match && match.amount != null) {
      return {
        amount: Number(match.amount), currency: match.currency, unit: match.unit,
        type: match.type, source: match.source, priceRecordId: match.id
      }
    }
  }
  return null
}

export async function bestValidCost(itemId: string, brandId: string | null = null): Promise<BestCost | null> {
  const svc = supabaseService()
  const { data: records } = await svc
    .from('price_records')
    .select('id, type, amount, currency, unit, price_date, validity_days, source, reusable, brand_id')
    .eq('item_id', itemId)
    .neq('type', 'market_intel')
  return pickBestCost((records ?? []) as CostRecord[], brandId)
}

export interface AgentCutConfig {
  cutMethod: 'onTop' | 'outOf' | 'fixedFee' | 'none'
  cutPct: number
  fixedFee: number
}

export type PricingMechanic = 'markup' | 'commission' | 'fee'

export interface MarginStackResult {
  emxMargin: number
  agentCut: number
  brandFacingPrice: number
  netMarginEmx: number
  netMarginPct: number
}

/**
 * cost -> EmergeX margin -> agent cut(s) -> brand-facing price, plus
 * EmergeX's net margin (PRD 6.6's "margin stack"). Agent cut math (A7) is
 * the same regardless of mechanic; what differs (A8) is how EmergeX's own
 * margin is derived from `rate`:
 *
 * - 'markup'     rate = % added on top of cost (cost-plus). Standard case.
 * - 'commission' rate = % of the BRAND-FACING price, not of cost — the
 *                 usual shape for a revenue-share arrangement. Solved as
 *                 sell = cost / (1 - rate) so that rate% of `sell` really
 *                 does equal the margin, rather than rate% of cost.
 * - 'fee'        rate is a flat currency amount, not a percentage —
 *                 EmergeX charges a fixed fee regardless of cost size.
 */
export function computeMarginStack(params: {
  cost: number
  rate: number
  mechanic: PricingMechanic
  agent: AgentCutConfig | null
}): MarginStackResult {
  const { cost, rate, mechanic, agent } = params

  let emxMargin: number
  if (mechanic === 'commission') {
    const sellBeforeAgent = rate < 100 ? cost / (1 - rate / 100) : cost // guard against a 100%+ rate dividing by zero/negative
    emxMargin = sellBeforeAgent - cost
  } else if (mechanic === 'fee') {
    emxMargin = rate // flat amount, not a percentage
  } else {
    emxMargin = cost * (rate / 100) // markup
  }
  const afterEmx = cost + emxMargin

  let agentCut = 0
  let brandFacingPrice = afterEmx
  let netMarginEmx = emxMargin

  if (agent?.cutMethod === 'onTop') {
    agentCut = afterEmx * (agent.cutPct / 100)
    brandFacingPrice = afterEmx + agentCut
  } else if (agent?.cutMethod === 'outOf') {
    agentCut = emxMargin * (agent.cutPct / 100)
    netMarginEmx = emxMargin - agentCut
    brandFacingPrice = afterEmx
  } else if (agent?.cutMethod === 'fixedFee') {
    agentCut = agent.fixedFee
    brandFacingPrice = afterEmx // fixed fee is billed at the proposal level, not per line
  }

  const netMarginPct = brandFacingPrice > 0 ? (netMarginEmx / brandFacingPrice) * 100 : 0
  return { emxMargin, agentCut, brandFacingPrice, netMarginEmx, netMarginPct }
}

/**
 * A10: below-band / above-market / edge-exemption warnings. Pure function —
 * the caller (the API route) is responsible for fetching the tier band,
 * the edge flag, and the latest market_intel price and passing them in,
 * since all three come from different tables.
 */
export function computeWarnings(params: {
  ratePct: number | null // null when mechanic is 'fee' (a flat amount isn't a band-comparable rate)
  mechanic: PricingMechanic
  marginBandLow: number | null
  marginBandHigh: number | null
  isEdge: boolean
  brandFacingPrice: number
  latestMarketIntelAmount: number | null
}): string[] {
  const warnings: string[] = []
  const { ratePct, mechanic, marginBandLow, marginBandHigh, isEdge, brandFacingPrice, latestMarketIntelAmount } = params

  if (!isEdge && mechanic !== 'fee' && ratePct != null) {
    if (marginBandLow != null && ratePct < marginBandLow) warnings.push(`Below tier band (${marginBandLow}–${marginBandHigh}%)`)
    if (marginBandHigh != null && ratePct > marginBandHigh) warnings.push(`Above tier band (${marginBandLow}–${marginBandHigh}%)`)
  }
  if (isEdge) warnings.push('Edge property — exempt from tier band')

  if (latestMarketIntelAmount != null && brandFacingPrice > latestMarketIntelAmount) {
    warnings.push(`Above known market price (${latestMarketIntelAmount.toLocaleString()})`)
  }

  return warnings
}

/**
 * A7: a route's own cut config overrides its agent's default — null fields
 * on the route mean "use the agent's default," not "no agent cut at all."
 * Centralized here so lines/route.ts and lines/[lineId]/margin/route.ts
 * can't drift into resolving this two different ways.
 */
export async function resolveAgentConfig(routeId: string | null): Promise<AgentCutConfig | null> {
  if (!routeId) return null
  const svc = supabaseService()
  const { data: route } = await svc
    .from('routes')
    .select('cut_method, cut_pct, fixed_fee, agents(cut_method, cut_pct, fixed_fee)')
    .eq('id', routeId)
    .single()
  if (!route) return null

  const agent = (route as unknown as { agents: { cut_method: string; cut_pct: number; fixed_fee: number } | null }).agents
  const routeOverride = route as unknown as { cut_method: string | null; cut_pct: number | null; fixed_fee: number | null }

  const cutMethod = routeOverride.cut_method ?? agent?.cut_method ?? 'none'
  const cutPct = routeOverride.cut_pct ?? agent?.cut_pct ?? 0
  const fixedFee = routeOverride.fixed_fee ?? agent?.fixed_fee ?? 0
  if (cutMethod === 'none') return null
  return { cutMethod: cutMethod as AgentCutConfig['cutMethod'], cutPct: Number(cutPct), fixedFee: Number(fixedFee) }
}

export interface PricingContext {
  marginBandLow: number | null
  marginBandHigh: number | null
  isEdge: boolean
  latestMarketIntelAmount: number | null
}

const MEDIA_IP_GROUPS = ['Media', 'IP and content']

/**
 * A11: "Media and IP: prices given to other brands shown internally." Only
 * meaningful for categories where the same inventory (a media slot, an IP
 * integration) plausibly gets quoted to several brands — sponsorship/talent
 * items are typically exclusive per deal, so this deliberately doesn't fire
 * for every category. Gated the same way as margin visibility (D10) since
 * it's the same kind of internal-commercial-sensitivity information.
 */
export async function getOtherBrandPrices(params: { itemId: string; excludeProposalId: string; categoryKey: string | null }): Promise<{ brand: string; sell_price: number }[]> {
  if (!params.categoryKey) return []
  const svc = supabaseService()
  const { data: cat } = await svc.from('categories').select('group_label').eq('key', params.categoryKey).single()
  if (!cat || !MEDIA_IP_GROUPS.includes(cat.group_label)) return []

  const { data: others } = await svc
    .from('proposal_lines')
    .select('sell_price, proposals(brand_id, brands(name))')
    .eq('item_id', params.itemId)
    .neq('proposal_id', params.excludeProposalId)

  return (others ?? [])
    .map((o) => ({ brand: (o as unknown as { proposals: { brands: { name: string } } }).proposals?.brands?.name, sell_price: Number(o.sell_price) }))
    .filter((o) => o.brand)
}

/** Everything computeWarnings needs, fetched from the three different tables it lives across. */
export async function getPricingContext(params: { brandId: string; itemId: string; propertyId: string }): Promise<PricingContext> {
  const svc = supabaseService()
  const [tier, edge, intel] = await Promise.all([
    svc.from('brand_tier').select('margin_band_low, margin_band_high').eq('brand_id', params.brandId).maybeSingle(),
    svc.from('property_edge').select('is_edge').eq('property_id', params.propertyId).maybeSingle(),
    svc.from('price_records').select('amount').eq('item_id', params.itemId).eq('type', 'market_intel').order('price_date', { ascending: false }).limit(1).maybeSingle()
  ])
  return {
    marginBandLow: tier.data ? Number(tier.data.margin_band_low) : null,
    marginBandHigh: tier.data ? Number(tier.data.margin_band_high) : null,
    isEdge: edge.data?.is_edge ?? false,
    latestMarketIntelAmount: intel.data ? Number(intel.data.amount) : null
  }
}

