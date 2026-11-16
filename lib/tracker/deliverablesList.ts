// "Deliverables list" importer (PURE): a sheet listing what was sold — e.g. ASSET | DETAILS | COMMENT, or SR NO | DELIVERABLE |
// DETAILS | REMARKS. It proposes deliverables with a quantity read from the details ("18", "6 per match", "24 per year", "✓").
// Everything is a SUGGESTION: the reviewer edits quantities, drops rows, and confirms.
import { text, isBlankRow, type Sheet } from './grid'

export interface ListRow {
  row: number; description: string; details: string; remarks: string
  quantity: number; unit: string | null; per: 'match' | 'year' | 'month' | null     // "6 per match": 6 is PER occasion — the reviewer says how many
  kind: 'deliverable' | 'term' | 'heading'; include: boolean; hint: string | null
}
export interface ListResult { headerRow: number | null; rows: ListRow[] }

const TERM = /exclusiv|contract (length|date|period|term)|^(start|end) date$|duration|term of|region|territor|usage of|image right|right of first|first refusal|rofr|non[- ]compete|payment|governing|^category$|^tier$|^package$|^sponsorship (level|type)$/i
const NAME = /^(asset|item)s?$|deliverable/i
const SPEC_UNIT = /\b(sq\.? ?cm|sq\.? ?m|cm|mm|px|pixels?|inch(es)?|sec(onds?)?|mins?|minutes?)\b/i

/** Reads a quantity out of a "details" cell. Returns what it understood and a hint when it had to guess. */
export function readQuantity(details: string): { quantity: number; unit: string | null; per: ListRow['per']; hint: string | null } {
  const d = details.replace(/\s+/g, ' ').trim()
  if (!d) return { quantity: 1, unit: null, per: null, hint: 'no quantity given — assumed 1' }
  if (/^(✓|✔|yes|y|included|true)$/i.test(d)) return { quantity: 1, unit: null, per: null, hint: null }
  const per = d.match(/^(\d+(?:[.,]\d+)?)\s*(?:x\s*)?(?:posts?|stories|story|reels?|days?|units?)?\s*(?:per|\/|a|each)\s*(match|game|year|annum|month)/i)
  if (per) { const p = /match|game/i.test(per[2]) ? 'match' : /year|annum/i.test(per[2]) ? 'year' : 'month'; return { quantity: Number(per[1].replace(',', '.')), unit: null, per: p, hint: `per ${p} — multiply by the number of ${p === 'match' ? 'matches' : p + 's'}` } }
  const spec = d.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/)
  if (spec && SPEC_UNIT.test(spec[2])) return { quantity: 1, unit: null, per: null, hint: `"${d}" looks like a size or length, not a quantity — kept as 1` }
  if (spec) {
    const n = Number(spec[1].replace(',', '.')), rest = spec[2].trim()
    if (n > 0 && n < 1) return { quantity: 1, unit: null, per: null, hint: `"${d}" is less than 1 — check what was meant; kept as 1` }
    if (n >= 1 && rest.length <= 40) return { quantity: n, unit: rest && /^[A-Za-z ]+$/.test(rest) ? rest.toLowerCase() : null, per: null, hint: rest && !/^[A-Za-z ]+$/.test(rest) ? `read ${n} from "${d}"` : null }
  }
  return { quantity: 1, unit: null, per: null, hint: `could not read a quantity from "${d.slice(0, 60)}" — assumed 1` }
}

export function parseDeliverablesList(sheet: Sheet): ListResult {
  const rows = sheet.rows
  // the header is the first row naming BOTH a name column and a details column (a merged title row above it is ignored)
  const headerIdx = rows.slice(0, 15).findIndex((r) => r.some((c) => NAME.test(text(c)) && text(c).length <= 40) && r.some((c) => /detail|quantity|qty|count|number|comment|remark/i.test(text(c))))
  const header = headerIdx >= 0 ? rows[headerIdx] : []
  const col = (re: RegExp) => { const i = header.findIndex((c) => re.test(text(c))); return i >= 0 ? i : null }
  const nameCol = col(NAME), detCol = col(/detail|quantity|qty|count|number/i), remCol = col(/comment|remark|note/i)
  const out: ListRow[] = []
  if (nameCol == null) return { headerRow: null, rows: out }
  rows.forEach((r, i) => {
    if (i <= headerIdx || isBlankRow(r)) return
    const description = text(r[nameCol]); if (!description) return
    const details = detCol != null ? text(r[detCol]) : '', remarks = remCol != null ? text(r[remCol]) : ''
    const others = r.filter((_, j) => j !== nameCol).every((c) => text(c) === '' || /^\d+$/.test(text(c)))
    if (others && !details && /^[A-Z0-9 &\/\-]{3,}$/.test(description) && description === description.toUpperCase()) { out.push({ row: i + 1, description, details, remarks, quantity: 1, unit: null, per: null, kind: 'heading', include: false, hint: 'looks like a section heading' }); return }
    // a size or length in the NAME ("Logo Size (sq. cm)") means the number beside it is a specification, not how many
    const q = SPEC_UNIT.test(description) && /^\d/.test(details) ? { quantity: 1, unit: null, per: null as ListRow['per'], hint: `"${details}" is the ${description.toLowerCase().replace(/\s*\(.*$/, '')}, not a quantity — kept as 1` } : readQuantity(details)
    const term = TERM.test(description)
    out.push({ row: i + 1, description: description.slice(0, 300), details, remarks, ...q, kind: term ? 'term' : 'deliverable', include: !term, hint: term ? 'looks like a contract term, not something to deliver — left unticked' : q.hint })
  })
  return { headerRow: headerIdx + 1, rows: out }
}
