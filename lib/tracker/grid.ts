// A spreadsheet reduced to what the importers need — PURE types and helpers, no file handling here.
export interface Cell { v: string | number | null; link: string | null; fill: string | null; date: string | null }   // date: ISO day when the cell is a real spreadsheet date
export interface Sheet { name: string; rows: Cell[][] }
export const cell = (v: string | number | null = null, o: Partial<Cell> = {}): Cell => ({ v, link: null, fill: null, date: null, ...o })
export const text = (c: Cell | undefined): string => (c == null || c.v == null ? '' : String(c.v).replace(/\s+/g, ' ').trim())
export const isBlankRow = (r: Cell[]) => r.every((c) => text(c) === '' && !c.link)
/** Roughly green? (ARGB like FF93C47D.) Used where a tracker says "highlighted in green means …". */
export function isGreen(argb: string | null): boolean {
  if (!argb || !/^[0-9a-f]{6,8}$/i.test(argb)) return false
  const h = argb.slice(-6), r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return g > 120 && g > r + 25 && g > b + 25
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const iso = (y: number, m: number, d: number): string | null => {
  if (y < 100) y += 2000
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null   // 31 Feb is refused, not rolled over
}
/**
 * Dates as people type them in trackers: "1 August 2024", "4th October 2024", "August 15, 2024", "15/08/2024", "15-08-24",
 * "2024-08-15" — possibly followed by a remark ("1 August 2024 ( Announcement Post"). Returns the day and whatever text was left.
 * Numeric dates are ambiguous, so the caller says whether they are day-first or month-first.
 */
export function parseLooseDate(raw: string, order: 'dmy' | 'mdy' = 'dmy'): { date: string | null; rest: string } {
  const s = raw.replace(/\s+/g, ' ').trim()
  const clean = (x: string) => x.replace(/^[\s\-–—:,(]+|[\s)]+$/g, '').trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\b(.*)$/)
  if (m) return { date: iso(+m[1], +m[2], +m[3]), rest: clean(m[4]) }
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[ \-]([A-Za-z]{3,9})\.?,?[ \-](\d{2,4})\b(.*)$/)
  if (m && MONTHS[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith('sept') ? 4 : 3)]) return { date: iso(+m[3], MONTHS[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith('sept') ? 4 : 3)], +m[1]), rest: clean(m[4]) }
  m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{2,4})\b(.*)$/)
  if (m && MONTHS[m[1].toLowerCase().slice(0, 3)]) return { date: iso(+m[3], MONTHS[m[1].toLowerCase().slice(0, 3)], +m[2]), rest: clean(m[4]) }
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b(.*)$/)
  if (m) return { date: order === 'dmy' ? iso(+m[3], +m[2], +m[1]) : iso(+m[3], +m[1], +m[2]), rest: clean(m[4]) }
  return { date: null, rest: s }
}
