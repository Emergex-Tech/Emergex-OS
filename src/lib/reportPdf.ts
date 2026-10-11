// PDF of a report or snapshot (L20) — pdf-lib: pure JavaScript, no browser and no font files, so it runs on Vercel.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { Report } from './reportBuilder'
import { fmtNum } from './caseStudy'

// The built-in PDF fonts cover Western-European text only (WinAnsi). Anything else becomes "?" rather than crashing the export.
const EXTRA = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178])
export function toWinAnsi(s: string): string {
  let out = ''
  for (const ch of s.replace(/[\r\n\t]+/g, ' ')) { const c = ch.codePointAt(0)!; out += (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || EXTRA.has(c) ? ch : c < 32 ? '' : '?' }
  return out
}

const INK = rgb(0.1, 0.1, 0.12), MUTED = rgb(0.4, 0.4, 0.45), AMBER = rgb(0.85, 0.55, 0.05), LINE = rgb(0.85, 0.85, 0.88)
const brandLine = (r: Report) => (r.branding.mode === 'emergex' || !r.branding.agent_name ? 'EmergeX' : r.branding.mode === 'agent' ? r.branding.agent_name : `EmergeX  x  ${r.branding.agent_name}`)

export async function renderReportPdf(r: Report): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const reg = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const W = 595, H = 842, M = 48, TOP = H - 56, BOTTOM = 56, WIDTH = W - 2 * M
  let page: PDFPage, y = TOP
  const pages: PDFPage[] = []
  const newPage = () => { page = doc.addPage([W, H]); pages.push(page); y = TOP }
  const wrap = (text: string, font: PDFFont, size: number, width: number): string[] => {
    const lines: string[] = []; let cur = ''
    for (const word of toWinAnsi(text).split(' ')) {
      let w = word
      while (font.widthOfTextAtSize(w, size) > width) { // a single very long word: break it
        let n = w.length; while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > width) n--
        if (cur) { lines.push(cur); cur = '' } lines.push(w.slice(0, n)); w = w.slice(n)
      }
      const t = cur ? `${cur} ${w}` : w
      if (font.widthOfTextAtSize(t, size) <= width) cur = t; else { lines.push(cur); cur = w }
    }
    if (cur) lines.push(cur); return lines.length ? lines : ['']
  }
  const text = (s: string, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) => {
    const size = o.size ?? 10, font = o.font ?? reg, indent = o.indent ?? 0
    for (const line of wrap(s, font, size, WIDTH - indent)) { if (y - size < BOTTOM) newPage(); page.drawText(line, { x: M + indent, y: y - size, size, font, color: o.color ?? INK }); y -= size * 1.35 }
    y -= o.gap ?? 0
  }
  const rule = () => { if (y - 8 < BOTTOM) newPage(); y -= 4; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE }); y -= 8 }
  const heading = (s: string) => { if (y - 40 < BOTTOM) newPage(); y -= 10; text(s, { size: 12, font: bold, color: AMBER, gap: 2 }) }

  newPage()
  text(brandLine(r), { size: 11, font: bold, color: AMBER, gap: 6 })
  text(r.title, { size: 20, font: bold, gap: 2 })
  text(`Prepared for ${r.brand_name}  -  as of ${r.as_of}`, { size: 10, color: MUTED, gap: 4 }); rule()

  const d = r.delivery
  text(d.pct == null ? 'Delivery: nothing to deliver yet' : `Delivery ${d.pct}%`, { size: 16, font: bold, gap: 1 })
  text(`${d.counted} deliverable${d.counted === 1 ? '' : 's'}: ${d.delivered} delivered, ${d.partial} partly delivered, ${d.planned} planned, ${d.missed} missed${d.replaced_excluded ? `  -  ${d.replaced_excluded} replaced by a make-good (not counted)` : ''}`, { size: 9, color: MUTED, gap: 4 })

  if (r.deliverables.length) {
    heading('Deliverables')
    for (const x of r.deliverables) {
      const unit = x.unit ? ` ${x.unit}` : ''
      text(x.description, { font: bold })
      text(x.status === 'replaced' ? 'Replaced by a make-good (counted under that deliverable)' : `${x.status}  -  ${fmtNum(x.delivered)} of ${fmtNum(x.planned)}${unit}  -  ${x.pct}%${x.due_date ? `  -  due ${x.due_date}` : ''}`, { size: 9, color: MUTED, indent: 8 })
      for (const p of x.proofs) text(`Proof: ${p.name} (${p.kind === 'link' ? 'link' : 'file'}, added ${p.added_on})`, { size: 9, indent: 8 })
      y -= 4
    }
  }
  if (r.metrics.summary.length) {
    heading('Reach and engagement')
    for (const m of r.metrics.summary) text(`${m.label}: ${fmtNum(m.value)}${m.unit === '%' ? '%' : m.unit ? ' ' + m.unit : ''}  (${m.aggregation === 'avg' ? 'average' : 'total'} of ${m.readings} reading${m.readings === 1 ? '' : 's'}, as of ${m.as_of})`, { size: 10 })
  }
  if (r.timeline.length) {
    heading('Timeline')
    for (const e of r.timeline.slice(-60)) text(`${e.date}   ${e.text}`, { size: 9 })
  }
  pages.forEach((p, i) => { p.drawText(toWinAnsi(`${brandLine(r)}  -  ${r.title}  -  page ${i + 1} of ${pages.length}`), { x: M, y: 28, size: 8, font: reg, color: MUTED }) })
  doc.setTitle(toWinAnsi(r.title)); doc.setProducer('EmergeX OS'); doc.setCreator('EmergeX OS')
  return doc.save()
}
