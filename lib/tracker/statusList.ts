// "Status list" importer (PURE): a sheet that says, per deliverable, whether it is done, with a proof link or a remark —
// e.g.  Deliverables | Comments | Links   →   "LED Boards | Completed | https://drive…",  "Meet & Greet | Not Completed | not wanted by brand".
// It proposes an action per row and a match to one of the project's deliverables. A person reviews every row before anything is saved.
import { parseProofLink, type Platform } from '../proofLinks'
import { text, isBlankRow, type Sheet } from './grid'

export type RowStatus = 'completed' | 'not_completed' | 'unknown'
export interface StatusRow {
  row: number; name: string; section: string | null; status: RowStatus; remark: string | null
  links: { url: string; platform: Platform }[]; rejected: string[]
  suggestion: 'complete' | 'waive' | 'none'; match: string | null; matchName: string | null
}
export interface StatusResult { headerRow: number | null; rows: StatusRow[]; unmatched: number }

const URLISH = /^https?:\/\/\S+$/i
const WAIVE = /not wanted|no longer (wanted|required|needed)|waived|not required|declined by|cancelled by (the )?(brand|client)|brand (does not|doesn'?t|did not|didn'?t) want/i
const STOP = new Set(['no', 'of', 'on', 'the', 'a', 'an', 'to', 'for', 'and', 'with', 'w', 'logo', 'use', 'number'])
const tokens = (s: string) => new Set(s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).map((t) => t.replace(/s$/, '')).filter((t) => t.length > 1 && !STOP.has(t)))
/**
 * The project deliverable a tracker row most plausibly refers to: shared words ÷ all words (ignoring filler like "No. of", "Logo on"),
 * at least half, and a CLEAR winner — if two deliverables tie, it matches neither and a person chooses.
 */
export function matchDeliverable(name: string, deliverables: { id: string; description: string }[]): { id: string; description: string } | null {
  const a = tokens(name); if (a.size === 0) return null
  const scored = deliverables.map((d) => { const b = tokens(d.description); const shared = Array.from(a).filter((t) => b.has(t)).length; return { d, score: shared / new Set([...Array.from(a), ...Array.from(b)]).size, shared } }).filter((x) => x.shared > 0 && x.score >= 0.5).sort((x, y) => y.score - x.score)
  if (!scored.length || (scored.length > 1 && scored[0].score === scored[1].score)) return null
  return scored[0].d
}

export function parseStatusList(sheet: Sheet, deliverables: { id: string; description: string }[] = []): StatusResult {
  const rows = sheet.rows
  const headerIdx = rows.slice(0, 15).findIndex((r) => r.some((c) => /^(asset|item)s?$|deliverable/i.test(text(c))) && r.some((c) => /^(comment|status|progress|state)s?$/i.test(text(c))))
  if (headerIdx < 0) return { headerRow: null, rows: [], unmatched: 0 }
  const h = rows[headerIdx].map((c) => text(c))
  const nameCol = h.findIndex((x) => /^(asset|item)s?$|deliverable/i.test(x)), statusCol = h.findIndex((x) => /^(comment|status|progress|state)s?$/i.test(x))
  const out: StatusRow[] = []; let section: string | null = null
  rows.forEach((r, i) => {
    if (i <= headerIdx || isBlankRow(r)) return
    const name = text(r[nameCol]), st = text(r[statusCol])
    if (!name) return
    if (st === name || (st === '' && r.every((c, j) => j === nameCol || text(c) === '' || text(c) === name))) { section = name.slice(0, 60); return }     // "BEFORE MATCH" repeated across the row
    const status: RowStatus = /^(not|in)\s*complete|^pending|^not done|^no$|^incomplete|^not started|^wip|in progress/i.test(st) ? 'not_completed' : /^complete|^done|^delivered|^yes$|^✓|^✔/i.test(st) ? 'completed' : 'unknown'
    const links: StatusRow['links'] = [], rejected: string[] = [], remarks: string[] = [], seen = new Set<string>()
    r.forEach((c, j) => {
      if (j === nameCol || j === statusCol) return
      const cand = [...String(c.v ?? '').split(/\s+/).filter((p) => URLISH.test(p)), ...(c.link && URLISH.test(c.link) ? [c.link] : [])]
      if (cand.length) { const p = parseProofLink(cand[0]); if (p.ok) { if (!seen.has(p.url)) { seen.add(p.url); links.push({ url: p.url, platform: p.platform }) } } else rejected.push(cand[0].slice(0, 200)) }
      else if (text(c)) remarks.push(text(c))
    })
    if (status === 'unknown' && st) remarks.unshift(st)
    const remark = remarks.join(' — ').slice(0, 300) || null
    const waive = !!remark && WAIVE.test(remark)
    const m = matchDeliverable(name, deliverables)
    out.push({ row: i + 1, name: name.slice(0, 200), section, status, remark, links, rejected, suggestion: waive ? 'waive' : status === 'completed' ? 'complete' : 'none', match: m?.id ?? null, matchName: m?.description ?? null })
  })
  return { headerRow: headerIdx + 1, rows: out, unmatched: out.filter((x) => !x.match).length }
}
