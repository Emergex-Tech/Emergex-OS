// Pure case-study logic (L23–L25) — no database, no AI. The draft is generated from the project's RECORDS by fixed rules, so
// every number in it is copied, never invented. The team edits and approves it.

export interface CaseStudyInput {
  projectName: string; brandName: string
  categories: string[]; markets: string[]; propertyNames: string[]
  deliveryPct: number | null; closedOn: string | null
  deliverables: { description: string; status: string; planned: number; delivered: number; unit: string | null; pct: number; proof_count: number }[]
  metrics: { label: string; value: number; unit: string | null; aggregation: 'sum' | 'avg'; subjects: number; as_of: string }[]
}
export interface CaseStudyResult { label: string; value: number; unit: string | null; as_of: string }
export interface CaseStudyDraft { title: string; body: string; results: CaseStudyResult[] }

export const fmtNum = (v: number): string => {
  const s = (Math.round(v * 100) / 100).toString()
  const [i, d] = s.split('.')
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : '')
}
export const joinList = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

export function draftCaseStudy(i: CaseStudyInput): CaseStudyDraft {
  const props = i.propertyNames.length ? ` on ${joinList(i.propertyNames)}` : ''
  const where = i.markets.length ? ` in ${joinList(i.markets)}` : ''
  const cats = i.categories.length ? ` (${joinList(i.categories)})` : ''
  const counted = i.deliverables.filter((d) => d.status !== 'replaced')
  const overview = [`${i.brandName} worked with EmergeX${props}${where}${cats}.`]
  if (i.deliveryPct != null) overview.push(`Overall delivery: ${i.deliveryPct}% across ${counted.length} deliverable${counted.length === 1 ? '' : 's'}.`)
  if (i.closedOn) overview.push(`Closed ${i.closedOn}.`)

  const lines = i.deliverables.slice(0, 20).map((d) => {
    const u = d.unit ? ` ${d.unit}` : ''
    const qty = `${fmtNum(d.delivered)} of ${fmtNum(d.planned)}${u} (${d.pct}%)`
    const proof = d.proof_count > 0 ? `, proof on file` : ''
    switch (d.status) {
      case 'delivered': case 'partial': return `- ${d.description}: ${qty}${proof}`
      case 'planned': return `- ${d.description}: not yet delivered`
      case 'missed': return `- ${d.description}: not delivered${d.delivered > 0 ? ` (${qty})` : ''}`
      case 'replaced': return `- ${d.description}: replaced by a make-good (counted under that deliverable)`
      default: return `- ${d.description}: ${d.status}`
    }
  })
  const more = i.deliverables.length > 20 ? [`- …and ${i.deliverables.length - 20} more`] : []
  const results = i.metrics.map((m) => ({ label: m.label, value: m.value, unit: m.unit, as_of: m.as_of }))
  const resultLines = i.metrics.map((m) => `- ${m.label}: ${fmtNum(m.value)}${m.unit === '%' ? '%' : m.unit ? ' ' + m.unit : ''} (${m.aggregation === 'avg' ? 'average' : 'total'} of ${m.subjects} reading${m.subjects === 1 ? '' : 's'}, as of ${m.as_of})`)

  const sections = [`## Overview\n${overview.join(' ')}`]
  if (lines.length) sections.push(`## What was delivered\n${[...lines, ...more].join('\n')}`)
  if (resultLines.length) sections.push(`## Results\n${resultLines.join('\n')}`)
  sections.push('## The story\n[Add the objective, what worked and anything the brand said. Everything above was generated from the project\'s records — check it before approving.]')
  return { title: i.projectName.slice(0, 200), body: sections.join('\n\n'), results }
}

// ---------- anonymising (D16: anonymised by default) ----------
const GENERIC = new Set(['sports', 'media', 'group', 'casino', 'network', 'digital', 'entertainment', 'gaming', 'limited', 'international', 'global', 'studios', 'agency', 'partners', 'marketing', 'holdings', 'solutions', 'services', 'company', 'events', 'league', 'premier', 'agents', 'agent', 'talent', 'management'])
/** The distinctive words of a name — the ones that would give it away on their own ("Blitz" in "Blitz Casino"), skipping generic ones. */
export function distinctiveWords(name: string): string[] {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (words.length === 1) return words[0].length >= 3 ? [words[0]] : []
  return words.filter((w) => w.length >= 4 && !GENERIC.has(w.toLowerCase()))
}
/** Every name the anonymised version must not contain: the brand, the project name, the partners — in full and by distinctive word. */
export function hiddenNames(i: { brand: string[]; projectName: string; partners: string[] }): { brand: string[]; partners: string[]; all: string[] } {
  const uniq = (xs: string[]) => Array.from(new Map(xs.map((x) => [x.toLowerCase(), x])).values())
  const brand = uniq([...i.brand.filter((n) => n.trim().length >= 3), ...i.brand.flatMap(distinctiveWords)])
  // The project name is usually "Brand — Property". When it contains the brand, hiding the brand already removes what identifies it, and the
  // rest (the PROPERTY, which a pitch is allowed to name) can stay — so the anonymised title reads "the brand — Gulf Premier League", not "a partner".
  // A project renamed to something that does NOT contain the brand ("Summer Blast 2026") is hidden in full.
  const nameRevealsBrand = brand.some((b) => i.projectName.toLowerCase().includes(b.toLowerCase()))
  const projectRule = i.projectName.trim().length >= 3 && !nameRevealsBrand ? [i.projectName] : []
  const partners = uniq([...projectRule, ...i.partners.filter((n) => n.trim().length >= 3).flatMap((n) => [n, ...distinctiveWords(n)])])
  return { brand, partners, all: uniq([...brand, ...partners]) }
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Longest names first, so "Blitz Casino" becomes "the brand" before "Blitz" is looked at. Whole words only; case-insensitive. */
export function anonymise(text: string, names: { brand: string[]; partners: string[] }): string {
  const rules = [...names.brand.map((n) => [n, 'the brand'] as const), ...names.partners.map((n) => [n, 'a partner'] as const)].sort((a, b) => b[0].length - a[0].length)
  let out = text
  for (const [n, by] of rules) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc(n)}(?![\\p{L}\\p{N}])`, 'giu'), by)
  return out.replace(/\bthe brand's\b/gi, "the brand's").replace(/\b(the brand)(\s+the brand)+/gi, '$1')
}
/** SUBSTRING match (stricter than anonymise's whole-word match on purpose): "Blitzkrieg" still contains "Blitz", so it is flagged for a human. */
export function findLeaks(text: string, names: string[]): string[] {
  const hay = text.toLowerCase()
  return names.filter((n) => n.trim().length >= 3 && hay.includes(n.trim().toLowerCase()))
}

// ---------- suggestions for a pitch (L25) ----------
export interface Studyish { id: string; category_keys: string[]; markets: string[]; property_names: string[]; brand_id: string | null; approved_at: string | null }
export interface Suggestion<T> { study: T; score: number; reasons: string[] }
/**
 * Relevance of approved case studies to a pitch: +3 per shared category, +2 per shared market, +2 per shared property.
 * A study for the SAME brand is not suggested for that brand's pitch (it is its own history, and would reveal it by name).
 * Ties: the more recently approved first. Studies that share nothing are not suggested at all.
 */
export function rankCaseStudies<T extends Studyish>(studies: T[], q: { categories: string[]; markets: string[]; propertyNames: string[]; brandId: string | null }, limit = 5): Suggestion<T>[] {
  const lc = (xs: string[]) => new Set(xs.map((x) => x.trim().toLowerCase()))
  const qc = lc(q.categories), qm = lc(q.markets), qp = lc(q.propertyNames)
  const out: Suggestion<T>[] = []
  for (const s of studies) {
    if (q.brandId && s.brand_id === q.brandId) continue
    const reasons: string[] = []; let score = 0
    for (const c of s.category_keys) if (qc.has(c.toLowerCase())) { score += 3; reasons.push(`same category: ${c}`) }
    for (const m of s.markets) if (qm.has(m.trim().toLowerCase())) { score += 2; reasons.push(`same market: ${m}`) }
    for (const p of s.property_names) if (qp.has(p.trim().toLowerCase())) { score += 2; reasons.push(`same property: ${p}`) }
    if (score > 0) out.push({ study: s, score, reasons })
  }
  return out.sort((a, b) => b.score - a.score || (b.study.approved_at ?? '').localeCompare(a.study.approved_at ?? '')).slice(0, limit)
}
