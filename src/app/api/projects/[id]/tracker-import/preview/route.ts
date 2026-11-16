import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { loadImportTarget, MAX_TRACKER_BYTES } from '@/lib/tracker/service'
import { loadWorkbook } from '@/lib/tracker/xlsx'
import { parsePostLog } from '@/lib/tracker/postLog'
import { parseDeliverablesList } from '@/lib/tracker/deliverablesList'
import { parseCampaignSheet, parseCampaignDaily } from '@/lib/tracker/adCampaign'
import { parseStatusList } from '@/lib/tracker/statusList'
import { errorResponse } from '@/lib/apiError'

export const runtime = 'nodejs'
export const maxDuration = 60
const KINDS = ['post_log', 'deliverables', 'ad_campaign', 'ad_daily', 'status_list'] as const

/**
 * Step 1 of a tracker import: read an uploaded .xlsx and SHOW what was understood. It saves NOTHING — the file is read in memory and
 * discarded. Without a sheet/kind it lists the sheets and what each looks like; with them it returns the parsed rows for review.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params   // Next 15+: route params arrive as a Promise
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.create')
    const target = await loadImportTarget(profile.org_id, params.id)
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) throw new ApiError(400, 'Choose the tracker file (.xlsx)')
    if (!/\.xlsx$/i.test(file.name)) throw new ApiError(400, 'Only Excel .xlsx files can be imported (save a Google Sheet as .xlsx first)')
    if (file.size === 0) throw new ApiError(400, 'The file is empty')
    if (file.size > MAX_TRACKER_BYTES) throw new ApiError(413, `The file is larger than ${MAX_TRACKER_BYTES / 1024 / 1024} MB`)
    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new ApiError(400, 'That file is not a real .xlsx workbook')
    let sheets
    try { sheets = await loadWorkbook(buffer) } catch (e) { throw new ApiError(400, e instanceof Error ? e.message : 'That file could not be read') }

    const kind = form?.get('kind'), sheetName = form?.get('sheet'), order = form?.get('date_order') ?? 'dmy'
    if (order !== 'dmy' && order !== 'mdy') throw new ApiError(400, "date_order must be 'dmy' or 'mdy'")
    const overview = sheets.map((s) => {
      const posts = parsePostLog(s, { dateOrder: order }).rows.filter((r) => r.links.length).length, list = parseDeliverablesList(s).rows.length
      const daily = parseCampaignDaily(s).readings.length, campaign = parseCampaignSheet(s).segments.length, status = parseStatusList(s).rows.filter((r) => r.status !== 'unknown').length
      const looks = daily >= 5 ? 'ad_daily' : campaign >= 1 ? 'ad_campaign' : status >= 2 ? 'status_list' : posts >= 2 && posts >= list ? 'post_log' : list >= 2 ? 'deliverables' : null
      return { name: s.name, rows: s.rows.length, looks_like: looks, posts, list_rows: list }
    })
    const base = { file: file.name.slice(0, 200), sheets: overview, has_contract: !!target.contractId, project_status: target.project.status, deliverables: target.deliverables }
    if (kind == null && sheetName == null) return NextResponse.json(base)
    if (!(KINDS as readonly unknown[]).includes(kind)) throw new ApiError(400, `kind must be one of: ${KINDS.join(', ')}`)
    const sheet = sheets.find((s) => s.name === sheetName)
    if (!sheet) throw new ApiError(400, 'That sheet is not in the file')
    if (kind === 'ad_campaign') {
      const result = parseCampaignSheet(sheet)
      // a region's figures that are EXACTLY the same in another sheet of the workbook are almost certainly a copy
      for (const other of sheets) { if (other.name === sheet.name) continue; const o = parseCampaignSheet(other).segments
        for (const s of result.segments) if (s.impressions > 0 && o.some((x) => x.segment === s.segment && x.impressions === s.impressions && x.clicks === s.clicks)) result.checks.push(`${s.segment} has EXACTLY the same figures as in the sheet "${other.name}" — one may be a copy of the other`) }
      result.checks = Array.from(new Set(result.checks))
      return NextResponse.json({ ...base, kind, sheet: sheet.name, result })
    }
    const result = kind === 'post_log' ? parsePostLog(sheet, { dateOrder: order }) : kind === 'ad_daily' ? parseCampaignDaily(sheet) : kind === 'status_list' ? parseStatusList(sheet, target.deliverables) : parseDeliverablesList(sheet)
    return NextResponse.json({ ...base, kind, sheet: sheet.name, date_order: order, result })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
