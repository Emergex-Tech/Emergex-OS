// "Post log" importer (PURE): a sheet where each row is one post / delivery, with a date and one or more links
// (e.g. columns Date | Instagram | Facebook | Twitter | TikTok, or Sr.No | Post Link | Notes). It only READS and proposes —
// a person reviews the result and confirms before anything is saved.
import { parseProofLink, type Platform } from '../proofLinks'
import { text, isBlankRow, isGreen, parseLooseDate, type Sheet } from './grid'

export interface PostRow { row: number; date: string | null; label: string | null; links: { url: string; platform: Platform }[]; rejected: string[]; highlighted: boolean; problems: string[] }
export interface PostLogResult { headerRow: number | null; dateColumn: number | null; rows: PostRow[]; skipped: number; undated: number; rejectedLinks: number; highlighted: number; legends: string[] }

const URLISH = /^https?:\/\/\S+$/i
/** The visible text first, then the cell's hyperlink — they are usually the same post, the hyperlink carrying a tracking parameter. */
const urlsOf = (c: { v: string | number | null; link: string | null }): string[] => {
  const out: string[] = []
  for (const part of String(c.v ?? '').split(/[\s,]+/)) if (URLISH.test(part)) out.push(part.trim())
  if (c.link && URLISH.test(c.link.trim())) out.push(c.link.trim())
  return Array.from(new Set(out))
}
/** Two links are the SAME post when host and path match; the query only matters where it carries the id (YouTube ?v=, Facebook story ids). */
const samePostKey = (url: string, platform: Platform): string => { const u = new URL(url); return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${platform === 'youtube' || platform === 'facebook' ? u.search : ''}`.toLowerCase() }
const LEGEND_LENGTH = 60   // a "note" longer than this is a legend or an instruction for the whole sheet, not a caption for one row
const LEGEND_WORDS = /highlight|colou?red?\b|\bmeans\b|legend/i

export function parsePostLog(sheet: Sheet, opts: { dateOrder?: 'dmy' | 'mdy' } = {}): PostLogResult {
  const rows = sheet.rows
  // header = the first row (in the top 15) that names a date or a link/platform column
  const headerIdx = rows.slice(0, 15).findIndex((r) => r.some((c) => /^(date|post date|sr\.? ?no\.?|s\.? ?no\.?)$/i.test(text(c)) || /link|instagram|facebook|twitter|tiktok|youtube/i.test(text(c))) && !r.some((c) => urlsOf(c).length))
  const header = headerIdx >= 0 ? rows[headerIdx] : []
  const col = (re: RegExp) => { const i = header.findIndex((c) => re.test(text(c))); return i >= 0 ? i : null }
  const dateCol = col(/date/i), noteCol = col(/note|remark|comment|caption|detail/i)
  const out: PostRow[] = [], legends: string[] = []; let skipped = 0
  rows.forEach((r, i) => {
    if (i <= headerIdx || isBlankRow(r)) return
    const found = r.flatMap((c) => urlsOf(c)), links: PostRow['links'] = [], rejected: string[] = [], seen = new Set<string>()
    for (const u of found) { const p = parseProofLink(u); if (p.ok) { const k = samePostKey(p.url, p.platform); if (!seen.has(k)) { seen.add(k); links.push({ url: p.url, platform: p.platform }) } } else rejected.push(u.slice(0, 200)) }
    const dc = dateCol != null ? r[dateCol] : undefined
    const parsed = dc ? (dc.date ? { date: dc.date, rest: '' } : parseLooseDate(text(dc), opts.dateOrder)) : { date: null, rest: '' }
    if (!links.length && !rejected.length && !parsed.date) { skipped++; return }            // a note row, a legend, a blank numbered row
    let note = noteCol != null ? text(r[noteCol]) : ''
    if (note.length > LEGEND_LENGTH || LEGEND_WORDS.test(note)) { legends.push(note.slice(0, 300)); note = '' }
    const label = [parsed.rest, note].filter((x) => x && !URLISH.test(x)).join(' — ').slice(0, 200) || null
    const problems: string[] = []
    if (dateCol != null && !parsed.date && text(dc)) problems.push(`could not read the date "${text(dc).slice(0, 40)}"`)
    if (!links.length) problems.push(rejected.length ? 'no acceptable link' : 'no link')
    out.push({ row: i + 1, date: parsed.date, label, links, rejected, highlighted: r.some((c) => isGreen(c.fill) && (urlsOf(c).length > 0)), problems })
  })
  return { headerRow: headerIdx >= 0 ? headerIdx + 1 : null, dateColumn: dateCol, rows: out, skipped, undated: out.filter((x) => !x.date).length, rejectedLinks: out.reduce((n, x) => n + x.rejected.length, 0), highlighted: out.filter((x) => x.highlighted).length, legends }
}
