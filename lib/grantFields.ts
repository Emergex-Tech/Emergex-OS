import { ApiError } from './auth'

/** Validates the editable fields of a grant: the white-label title and the indicative price a manager chooses to show an agent. */
export function parseGrantFields(body: Record<string, unknown>): { display_title?: string | null; indicative_price?: number | null; price_currency?: string } {
  const out: { display_title?: string | null; indicative_price?: number | null; price_currency?: string } = {}
  if ('display_title' in body) {
    const t = body.display_title == null ? '' : String(body.display_title).trim()
    if (t.length > 120) throw new ApiError(400, 'display_title can be at most 120 characters')
    out.display_title = t || null
  }
  if ('indicative_price' in body) {
    if (body.indicative_price == null || body.indicative_price === '') out.indicative_price = null
    else {
      const p = Number(body.indicative_price)
      if (!Number.isFinite(p) || p < 0 || p > 1e9) throw new ApiError(400, 'indicative_price must be a number between 0 and 1,000,000,000')
      out.indicative_price = p
    }
  }
  if ('price_currency' in body) {
    const c = String(body.price_currency ?? 'USD').toUpperCase()
    if (!/^[A-Z]{3}$/.test(c)) throw new ApiError(400, 'price_currency must be a 3-letter code')
    out.price_currency = c
  }
  return out
}
