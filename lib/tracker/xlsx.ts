// Reads an uploaded .xlsx into plain grids for the importers. SERVER ONLY (uses exceljs).
import ExcelJS from 'exceljs'
import { cell, type Cell, type Sheet } from './grid'

export const MAX_SHEETS = 40, MAX_ROWS = 3000, MAX_COLS = 60
const isoDay = (d: Date) => (Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null)

function readCell(c: ExcelJS.Cell): Cell {
  let v: unknown = c.value, link: string | null = null, date: string | null = null
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as { text?: unknown; hyperlink?: unknown; richText?: { text: string }[]; result?: unknown; error?: unknown; formula?: unknown }
    if (typeof o.hyperlink === 'string') link = o.hyperlink
    if (Array.isArray(o.richText)) v = o.richText.map((t) => t.text).join('')
    else if ('result' in o || 'formula' in o) v = o.result ?? null          // a formula: use what it evaluated to, never the formula
    else if ('error' in o) v = null
    else if ('text' in o) v = typeof o.text === 'object' && o.text && 'richText' in (o.text as object) ? ((o.text as { richText: { text: string }[] }).richText ?? []).map((t) => t.text).join('') : o.text
    if (v && typeof v === 'object' && !(v instanceof Date)) v = null
  }
  if (v instanceof Date) { date = isoDay(v); v = date }
  if (!link && typeof c.hyperlink === 'string') link = c.hyperlink
  const fill = c.fill && c.fill.type === 'pattern' && c.fill.fgColor && typeof c.fill.fgColor.argb === 'string' ? c.fill.fgColor.argb : null
  const out = typeof v === 'number' ? (Number.isFinite(v) ? v : null) : v == null ? null : String(v).slice(0, 2000)
  return cell(out, { link: link ? link.slice(0, 700) : null, fill, date })
}

/** Throws a plain Error with a readable message if the file is not a usable workbook. */
export async function loadWorkbook(buffer: Buffer): Promise<Sheet[]> {
  const wb = new ExcelJS.Workbook()
  try { await wb.xlsx.load(buffer as unknown as ArrayBuffer) } catch { throw new Error('That file could not be read as an Excel workbook (.xlsx)') }
  if (wb.worksheets.length > MAX_SHEETS) throw new Error(`That workbook has more than ${MAX_SHEETS} sheets`)
  return wb.worksheets.map((ws) => {
    const rows: Cell[][] = []
    const lastRow = Math.min(ws.rowCount, MAX_ROWS), lastCol = Math.min(ws.columnCount, MAX_COLS)
    for (let r = 1; r <= lastRow; r++) { const row = ws.getRow(r); const cells: Cell[] = []; for (let c = 1; c <= lastCol; c++) cells.push(readCell(row.getCell(c))); rows.push(cells) }
    while (rows.length && rows[rows.length - 1].every((c) => c.v == null && !c.link)) rows.pop()
    return { name: ws.name, rows }
  })
}
