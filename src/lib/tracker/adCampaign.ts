// "Ad campaign report" importer (PURE): a publisher's delivery report — guaranteed vs served impressions, clicks, split by region and
// ad type, either as a summary sheet per campaign or as a table of daily rows. It only READS and proposes; a person reviews it.
// It also CHECKS the sheet against itself, because real reports disagree with themselves (copied blocks, totals that don't add up).
import { text, type Cell, type Sheet } from './grid'

export interface CampaignBlock { side: 'brand' | 'vendor' | 'unknown'; title: string; gtd: number | null; served: number | null; clicks: number | null; campaignDate: string | null }
export interface Segment { region: string; adType: string | null; segment: string; gtd: number | null; impressions: number; clicks: number | null }
export interface CampaignResult { blocks: CampaignBlock[]; brandGtd: number | null; vendorGtd: number | null; sheetGtd: number | null; segments: Segment[]; totals: { impressions: number; clicks: number }; checks: string[] }
export interface DailyReading { recorded_on: string; segment: string; impressions: number; clicks: number }
export interface DailyResult { headerRow: number | null; days: number; firstDay: string | null; lastDay: string | null; rowsRead: number; rowsSkipped: number; segments: Segment[]; readings: DailyReading[]; totals: { impressions: number; clicks: number }; checks: string[] }

const num = (c: Cell | undefined): number | null => (c && typeof c.v === 'number' && Number.isFinite(c.v) ? c.v : c && typeof c.v === 'string' && /^-?[\d,]+(\.\d+)?$/.test(c.v.trim()) ? Number(c.v.replace(/,/g, '')) : null)
/** A date cell, or a raw spreadsheet serial number (45928 = 2025-09-28) where someone lost the date format. */
export function cellDay(c: Cell | undefined): string | null {
  if (!c) return null
  if (c.date) return c.date
  const n = num(c)
  if (n != null && Number.isInteger(n) && n > 36000 && n < 73000) return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10)
  return null
}
export function normRegion(raw: string): string {
  const s = raw.trim().toUpperCase()
  if (/^(IN|IND|INDIA)$/.test(s)) return 'IN'; if (/^(PK|PAK|PAKISTAN)$/.test(s)) return 'PK'; if (/^(BD|BAN|BANGLADESH)$/.test(s)) return 'BD'
  if (/^(LK|SL|SRI ?LANKA)$/.test(s)) return 'LK'; if (/^(NP|NEPAL)$/.test(s)) return 'NP'; if (/^(AE|UAE)$/.test(s)) return 'AE'
  return s.slice(0, 12)
}
export const normAdType = (raw: string): string => (/inter/i.test(raw) ? 'Interstitial' : /banner/i.test(raw) ? 'Banner' : /video/i.test(raw) ? 'Video' : /native/i.test(raw) ? 'Native' : raw.trim().slice(0, 20))
const seg = (region: string, adType: string | null) => (adType ? `${region} · ${adType}` : region)
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

export function parseCampaignSheet(sheet: Sheet): CampaignResult {
  const rows = sheet.rows, checks: string[] = []
  // ---- key / value blocks (one, or two side by side: what the publisher guarantees us, and what we guarantee the brand)
  const byCol = new Map<number, CampaignBlock & { pending: number | null }>()
  const blockAt = (j: number) => { if (!byCol.has(j)) { const title = text(rows[0]?.[j]) || text(rows[1]?.[j]); byCol.set(j, { side: /brand/i.test(title) ? 'brand' : /cricket|publisher|vendor|internal|network/i.test(title) ? 'vendor' : 'unknown', title: title.slice(0, 60), gtd: null, served: null, clicks: null, campaignDate: null, pending: null }) } return byCol.get(j)! }
  rows.forEach((r) => r.forEach((c, j) => {
    const k = text(c).toUpperCase(), v = r[j + 1]
    if (/^GTD IMPRESSIONS?$/.test(k) && num(v) != null) blockAt(j).gtd = num(v)
    else if (/^IMPRESSIONS? SERVED$/.test(k) && num(v) != null) blockAt(j).served = num(v)
    else if (/^IMPRESSIONS? PENDING$/.test(k) && num(v) != null) blockAt(j).pending = num(v)
    else if (/^(TOTAL )?CLICKS$/.test(k) && num(v) != null) blockAt(j).clicks = num(v)
    else if (/^CAMPAIGN (START )?DATE$/.test(k) && cellDay(v)) blockAt(j).campaignDate = cellDay(v)
  }))
  const blocks = Array.from(byCol.entries()).sort((a, b) => a[0] - b[0]).map(([, b]) => b)
  for (const b of blocks) if (b.gtd != null && b.served != null && b.pending != null && Math.abs(b.gtd - b.served - b.pending) > 1) checks.push(`${b.title || 'The summary'}: "pending" is ${fmt(b.pending)}, but guaranteed − served is ${fmt(b.gtd - b.served)}`)

  // ---- region tables: a header row "ADS Type | [GTD] | Impressions | Clicks | CTR", titled with the region on the row above
  const segments: Segment[] = []
  const blocksSeen: { region: string; sig: string }[] = []
  rows.forEach((r, i) => r.forEach((c, j) => {
    if (!/^ADS? ?TYPE$/i.test(text(c))) return
    const head = r.slice(j + 1, j + 8).map((x) => text(x).toLowerCase())
    const col = (re: RegExp, not?: RegExp) => { const k = head.findIndex((h) => re.test(h) && !(not && not.test(h))); return k >= 0 ? j + 1 + k : null }
    const gtdCol = col(/gtd|guarant/), impCol = col(/impression/, /gtd|guarant/), clickCol = col(/click/)
    if (impCol == null) return
    const title = text(rows[i - 1]?.[j]); const hasTitle = title !== '' && !/ads? ?type/i.test(title)
    let sumImp = 0, sumClk = 0; const sig: string[] = []
    for (let k = i + 1; k < rows.length; k++) {
      const label = text(rows[k][j]), imp = num(rows[k][impCol]), clk = clickCol != null ? num(rows[k][clickCol]) : null
      if (label === '' && imp == null) break
      if (label === '' || /^total$/i.test(label)) { if (imp != null && Math.abs(imp - sumImp) > 1) checks.push(`${hasTitle ? normRegion(title) : 'A table'}: its total row says ${fmt(imp)} impressions, but its rows add up to ${fmt(sumImp)}`); break }
      if (imp == null) continue
      const region = hasTitle ? normRegion(title) : normRegion(label), adType = hasTitle ? normAdType(label) : null
      segments.push({ region, adType, segment: seg(region, adType), gtd: gtdCol != null ? num(rows[k][gtdCol]) : null, impressions: imp, clicks: clk })
      sumImp += imp; sumClk += clk ?? 0; sig.push(`${adType}|${imp}|${clk}`)
      if (clk != null && imp > 0 && clk / imp > 0.2) checks.push(`${seg(region, adType)}: a click-through rate of ${Math.round((clk / imp) * 1000) / 10}% is implausibly high — check the figures`)
    }
    if (sig.length) blocksSeen.push({ region: hasTitle ? normRegion(title) : '(table)', sig: sig.join(';') })
  }))
  for (let a = 0; a < blocksSeen.length; a++) for (let b = a + 1; b < blocksSeen.length; b++) if (blocksSeen[a].sig === blocksSeen[b].sig && blocksSeen[a].region !== blocksSeen[b].region && !/\|0\|/.test(blocksSeen[a].sig)) checks.push(`${blocksSeen[a].region} and ${blocksSeen[b].region} have IDENTICAL figures — one looks like a copy of the other`)
  const dupSeg = segments.map((s) => s.segment).filter((s, i, all) => all.indexOf(s) !== i)
  if (dupSeg.length) checks.push(`The same region and ad type appears more than once: ${Array.from(new Set(dupSeg)).join(', ')}`)

  const totals = { impressions: segments.reduce((s, x) => s + x.impressions, 0), clicks: segments.reduce((s, x) => s + (x.clicks ?? 0), 0) }
  const brand = blocks.find((b) => b.side === 'brand'), vendor = blocks.find((b) => b.side === 'vendor'), main = brand ?? vendor ?? blocks[0]
  if (segments.length && main?.served != null && Math.abs(main.served - totals.impressions) > 1) checks.push(`The summary says ${fmt(main.served)} impressions served, but the regional tables add up to ${fmt(totals.impressions)}`)
  if (segments.length && main?.clicks != null && Math.abs(main.clicks - totals.clicks) > 1) checks.push(`The summary says ${fmt(main.clicks)} clicks, but the regional tables add up to ${fmt(totals.clicks)}`)
  return { blocks: blocks.map(({ side, title, gtd, served, clicks, campaignDate }) => ({ side, title, gtd, served, clicks, campaignDate })), brandGtd: brand?.gtd ?? null, vendorGtd: vendor?.gtd ?? null, sheetGtd: !brand && !vendor ? blocks[0]?.gtd ?? null : null, segments, totals, checks: Array.from(new Set(checks)) }
}

const weekKey = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10) }
/**
 * Daily rows (Date | Region | Type | GTD | Delivered | Clicks …). Each row is ONE DAY's figures; the system keeps running totals,
 * so they are added up per region and ad type. To keep the trend without thousands of readings, one running total is kept per
 * WEEK (at the last day with data in that week), plus the final day.
 */
export function parseCampaignDaily(sheet: Sheet): DailyResult {
  const rows = sheet.rows, checks: string[] = []
  const headerIdx = rows.slice(0, 15).findIndex((r) => r.some((c) => /deliver|served/i.test(text(c))) && r.some((c) => /inventory|type/i.test(text(c))))
  const empty: DailyResult = { headerRow: null, days: 0, firstDay: null, lastDay: null, rowsRead: 0, rowsSkipped: 0, segments: [], readings: [], totals: { impressions: 0, clicks: 0 }, checks }
  if (headerIdx < 0) return empty
  const h = rows[headerIdx].map((c) => text(c).toLowerCase())
  const typeCol = h.findIndex((x) => /inventory|type/.test(x)), delCol = h.findIndex((x) => /deliver|served/.test(x)), clickCol = h.findIndex((x) => /click/.test(x)), gtdCol = h.findIndex((x) => /gtd|guarant/.test(x))
  const sample = rows.slice(headerIdx + 1, headerIdx + 30)
  const dateCol = h.findIndex((_, j) => sample.filter((r) => cellDay(r[j])).length >= Math.max(1, Math.floor(sample.length / 2)))
  if (dateCol < 0 || typeCol < 0 || delCol < 0) return empty
  const regionCol = h.findIndex((_, j) => j !== dateCol && j !== typeCol && sample.filter((r) => /^[A-Za-z ]{2,12}$/.test(text(r[j]))).length >= Math.max(1, Math.floor(sample.length / 2)))
  const day: Record<string, Record<string, { imp: number; clk: number }>> = {}, gtd: Record<string, number> = {}
  let read = 0, skipped = 0
  for (const r of rows.slice(headerIdx + 1)) {
    if (r.every((c) => text(c) === '')) continue
    const d = cellDay(r[dateCol]), imp = num(r[delCol]), type = text(r[typeCol])
    if (!d || imp == null || !type || imp < 0) { skipped++; continue }
    const region = regionCol >= 0 && text(r[regionCol]) ? normRegion(text(r[regionCol])) : 'ALL', s = seg(region, normAdType(type))
    ;(day[d] ??= {})[s] ??= { imp: 0, clk: 0 }; day[d][s].imp += imp; day[d][s].clk += Math.max(0, (clickCol >= 0 ? num(r[clickCol]) : null) ?? 0)
    if (gtdCol >= 0) gtd[s] = (gtd[s] ?? 0) + Math.max(0, num(r[gtdCol]) ?? 0)
    read++
  }
  const days = Object.keys(day).sort(); if (!days.length) return { ...empty, headerRow: headerIdx + 1, rowsSkipped: skipped }
  const segNames = Array.from(new Set(days.flatMap((d) => Object.keys(day[d])))).sort()
  const run: Record<string, { imp: number; clk: number }> = Object.fromEntries(segNames.map((s) => [s, { imp: 0, clk: 0 }]))
  const lastOfWeek = new Map<string, string>(); for (const d of days) lastOfWeek.set(weekKey(d), d)
  const keep = new Set(lastOfWeek.values()), readings: DailyReading[] = []
  for (const d of days) { for (const s of Object.keys(day[d])) { run[s].imp += day[d][s].imp; run[s].clk += day[d][s].clk } if (keep.has(d)) for (const s of segNames) if (run[s].imp > 0 || run[s].clk > 0) readings.push({ recorded_on: d, segment: s, impressions: run[s].imp, clicks: run[s].clk }) }
  const segments = segNames.map((s) => { const [region, adType] = s.split(' · '); return { region, adType: adType ?? null, segment: s, gtd: gtd[s] ? gtd[s] : null, impressions: run[s].imp, clicks: run[s].clk } })
  for (const s of segments) if (s.impressions > 0 && (s.clicks ?? 0) / s.impressions > 0.2) checks.push(`${s.segment}: a click-through rate of ${Math.round(((s.clicks ?? 0) / s.impressions) * 1000) / 10}% is implausibly high — check the figures`)
  if (skipped) checks.push(`${skipped} row${skipped === 1 ? ' was' : 's were'} skipped (no date, no ad type, or no delivered figure)`)
  return { headerRow: headerIdx + 1, days: days.length, firstDay: days[0], lastDay: days[days.length - 1], rowsRead: read, rowsSkipped: skipped, segments, readings, totals: { impressions: segments.reduce((a, x) => a + x.impressions, 0), clicks: segments.reduce((a, x) => a + (x.clicks ?? 0), 0) }, checks }
}
