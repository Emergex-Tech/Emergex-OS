import ExcelJS from 'exceljs'

/**
 * A18 — brand-facing Excel export.
 *
 * D9 (export layout) is an open decision in the PRD, so THIS LAYOUT IS A DRAFT.
 * It is deliberately isolated in this one file: swapping in a real template later
 * means editing buildProposalWorkbook() and nothing else.
 *
 * The input type below has no cost, margin, agent, or vendor fields on purpose.
 * The route that calls this can only hand it brand-facing values, so a leak would
 * need a type change, not just a slip.
 */
export interface ExportLine {
  property: string
  item: string
  basis: string | null // pricing unit, e.g. "per_match" or "flat"
  quantity: number
  unitPrice: number
}
export interface ExportData {
  brandName: string
  contactName?: string | null
  currency: string
  versionNumber: number
  preparedOn: Date
  lines: ExportLine[]
}

const humanize = (s: string | null) => (s ? s.replace(/_/g, ' ') : '')

export async function buildProposalWorkbook(d: ExportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'EmergeX'
  wb.created = d.preparedOn
  const ws = wb.addWorksheet('Proposal', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })

  ws.columns = [
    { width: 5 }, { width: 30 }, { width: 34 }, { width: 14 }, { width: 8 }, { width: 16 }, { width: 18 }
  ]

  ws.mergeCells('A1:G1')
  ws.getCell('A1').value = 'EmergeX'
  ws.getCell('A1').font = { bold: true, size: 18 }

  const meta: [string, string][] = [
    ['Prepared for', d.brandName],
    ...(d.contactName ? [['Attention', d.contactName] as [string, string]] : []),
    ['Date', d.preparedOn.toISOString().slice(0, 10)],
    ['Version', `v${d.versionNumber}`]
  ]
  let row = 3
  for (const [label, value] of meta) {
    ws.getCell(`A${row}`).value = label
    ws.getCell(`A${row}`).font = { bold: true }
    ws.mergeCells(`A${row}:B${row}`)
    ws.getCell(`C${row}`).value = value
    row++
  }

  row++ // spacer
  const headerRow = row
  const headers = ['#', 'Property', 'Item', 'Basis', 'Qty', `Unit price (${d.currency})`, `Total (${d.currency})`]
  headers.forEach((h, i) => {
    const c = ws.getCell(headerRow, i + 1)
    c.value = h
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
    c.alignment = { vertical: 'middle', horizontal: i >= 4 ? 'right' : 'left' }
  })
  ws.views = [{ state: 'frozen', ySplit: headerRow }]

  const money = '#,##0.00'
  let r = headerRow + 1
  const firstDataRow = r
  d.lines.forEach((l, i) => {
    ws.getCell(r, 1).value = i + 1
    ws.getCell(r, 2).value = l.property
    ws.getCell(r, 3).value = l.item
    ws.getCell(r, 4).value = humanize(l.basis)
    ws.getCell(r, 5).value = l.quantity
    ws.getCell(r, 6).value = l.unitPrice
    ws.getCell(r, 6).numFmt = money
    // Formula with a cached result, so it displays correctly in viewers that don't recalculate.
    ws.getCell(r, 7).value = { formula: `E${r}*F${r}`, result: Math.round(l.quantity * l.unitPrice * 100) / 100 }
    ws.getCell(r, 7).numFmt = money
    r++
  })
  const lastDataRow = r - 1

  const grand = Math.round(d.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) * 100) / 100
  ws.getCell(r, 6).value = 'Total'
  ws.getCell(r, 6).font = { bold: true }
  ws.getCell(r, 6).alignment = { horizontal: 'right' }
  ws.getCell(r, 7).value = d.lines.length ? { formula: `SUM(G${firstDataRow}:G${lastDataRow})`, result: grand } : 0
  ws.getCell(r, 7).numFmt = money
  ws.getCell(r, 7).font = { bold: true }
  ws.getCell(r, 7).border = { top: { style: 'thin' } }

  return Buffer.from(await wb.xlsx.writeBuffer())
}
