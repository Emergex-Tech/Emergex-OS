import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadImportTarget } from '@/lib/tracker/service'
import { projectCategories } from '@/lib/projectService'
import { statusForQuantity, type DeliveryStatus } from '@/lib/delivery'
import { isValidIsoDate } from '@/lib/billing'
import { errorResponse } from '@/lib/apiError'

const MAX_READINGS = 1500, CATEGORY = 'digital_publisher_app', SOURCE = 'Publisher report (imported)'
const IMPLAUSIBLE_CTR = 0.2
/**
 * Step 2 of an ad-campaign import: record impressions and clicks per region / ad type as running totals, and set the "guaranteed
 * impressions" deliverable to what was served. {deliverable_id, readings:[{recorded_on, segment, impressions, clicks}], brand_quantity?,
 * vendor_quantity?, acknowledge_implausible?}. Everything is validated first; nothing is half-saved. A click-through rate above 20% in
 * any segment is refused unless explicitly acknowledged — real reports contain such errors. Click-through rate is CALCULATED from total
 * clicks ÷ total impressions, never averaged across segments. Importing the same report again adds nothing.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params   // Next 15+: route params arrive as a Promise
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.create')
    const target = await loadImportTarget(profile.org_id, params.id)
    const b = await req.json().catch(() => ({}))
    const d = target.deliverables.find((x) => x.id === b.deliverable_id)
    if (!d) throw new ApiError(400, 'Choose the deliverable that holds the guaranteed impressions')
    if (d.status === 'replaced' || d.status === 'waived') throw new ApiError(400, `That deliverable is ${d.status}`)
    if (!(await projectCategories(profile.org_id, target.project.deal_id)).includes(CATEGORY)) throw new ApiError(400, 'This project\'s inventory is not a digital publisher / app, so it has no impressions and clicks to record')
    const setTerms = b.brand_quantity != null || b.vendor_quantity != null
    if (setTerms) await requirePermission(profile, 'contract.manage')
    const qty = (v: unknown, what: string) => { if (v == null) return null; const n = Number(v); if (!Number.isFinite(n) || n <= 0 || n > 1e13) throw new ApiError(400, `${what} must be greater than zero`); return Math.round(n) }
    const brandQty = qty(b.brand_quantity, 'The guarantee to the brand'), vendorQty = qty(b.vendor_quantity, 'The publisher\'s guarantee')
    if (!Array.isArray(b.readings) || b.readings.length === 0) throw new ApiError(400, 'There is nothing to import')
    if (b.readings.length > MAX_READINGS) throw new ApiError(400, `At most ${MAX_READINGS} readings at a time`)
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    type R = { recorded_on: string; segment: string; impressions: number; clicks: number }
    const rows: R[] = [], rejected: { index: number; error: string }[] = []
    b.readings.forEach((r: Record<string, unknown>, index: number) => {
      try {
        if (!r || typeof r !== 'object') throw new Error('Not a valid reading')
        if (typeof r.recorded_on !== 'string' || !isValidIsoDate(r.recorded_on)) throw new Error('needs a valid date (YYYY-MM-DD)')
        if (r.recorded_on > tomorrow) throw new Error('the date is in the future')
        const segment = typeof r.segment === 'string' ? r.segment.trim() : ''
        if (segment.length < 1 || segment.length > 60) throw new Error('needs a region / ad type of 1–60 characters')
        const imp = Number(r.impressions), clk = r.clicks == null ? 0 : Number(r.clicks)
        if (!Number.isFinite(imp) || imp < 0 || imp > 1e13) throw new Error('impressions must be a number of 0 or more')
        if (!Number.isFinite(clk) || clk < 0) throw new Error('clicks must be a number of 0 or more')
        if (clk > imp) throw new Error(`more clicks (${clk}) than impressions (${imp}) is impossible`)
        rows.push({ recorded_on: r.recorded_on, segment, impressions: Math.round(imp), clicks: Math.round(clk) })
      } catch (err) { rejected.push({ index, error: err instanceof Error ? err.message : String(err) }) }
    })
    if (rejected.length) return NextResponse.json({ error: `${rejected.length} ${rejected.length === 1 ? 'reading is' : 'readings are'} not valid, so nothing was imported`, rejected }, { status: 400 })
    if (new Set(rows.map((r) => `${r.recorded_on}|${r.segment}`)).size !== rows.length) throw new ApiError(400, 'The same region / ad type appears twice for one date')

    const latest = new Map<string, R>(); for (const r of rows) { const cur = latest.get(r.segment); if (!cur || r.recorded_on > cur.recorded_on) latest.set(r.segment, r) }
    const last = Array.from(latest.values())
    const implausible = last.filter((r) => r.impressions > 0 && r.clicks / r.impressions > IMPLAUSIBLE_CTR).map((r) => `${r.segment}: ${Math.round((r.clicks / r.impressions) * 1000) / 10}%`)
    if (implausible.length && b.acknowledge_implausible !== true) return NextResponse.json({ error: `A click-through rate above ${IMPLAUSIBLE_CTR * 100}% is almost certainly an error in the report (${implausible.join('; ')}). Correct the figures, or confirm that you want to import them as they are.`, implausible }, { status: 409 })

    const svc = supabaseService()
    const { count: logged } = await svc.from('deliverable_events').select('id', { count: 'exact', head: true }).eq('deliverable_id', d.id).is('voided_at', null)
    if ((logged ?? 0) > 0) throw new ApiError(409, 'That deliverable is tracked by a delivery log, so its number cannot be set from a report. Choose (or create) a deliverable for the guaranteed impressions.')
    const { data: have } = await svc.from('project_metrics').select('metric_key, segment, recorded_on, value').eq('project_id', target.project.id).eq('deliverable_id', d.id).eq('category_key', CATEGORY).is('voided_at', null).limit(20000)
    const seen = new Set((have ?? []).map((e) => `${e.metric_key}|${e.segment ?? ''}|${e.recorded_on}|${Number(e.value)}`))
    const base = { org_id: profile.org_id, project_id: target.project.id, deliverable_id: d.id, category_key: CATEGORY, source: SOURCE, recorded_by: profile.id }
    const inserts: Record<string, unknown>[] = []
    const add = (metric_key: string, segment: string | null, recorded_on: string, value: number) => { const k = `${metric_key}|${segment ?? ''}|${recorded_on}|${value}`; if (seen.has(k)) return; seen.add(k); inserts.push({ ...base, metric_key, segment, recorded_on, value }) }
    for (const r of rows) { add('impressions', r.segment, r.recorded_on, r.impressions); add('clicks', r.segment, r.recorded_on, r.clicks) }
    if (inserts.length) { const { error } = await svc.from('project_metrics').insert(inserts); if (error) throw new ApiError(400, error.message) }

    // What was served is the sum of the LATEST stored reading per segment — from everything on record, not just this file — so
    // importing an older or partial report later can never drag the delivered figure backwards.
    const { data: all } = await svc.from('project_metrics').select('metric_key, segment, recorded_on, value, created_at').eq('project_id', target.project.id).eq('deliverable_id', d.id).eq('category_key', CATEGORY).in('metric_key', ['impressions', 'clicks']).is('voided_at', null).limit(20000)
    const newest = new Map<string, { recorded_on: string; created_at: string; value: number }>()
    for (const e of all ?? []) { const k = `${e.metric_key}|${e.segment ?? ''}`, cur = newest.get(k); if (!cur || e.recorded_on > cur.recorded_on || (e.recorded_on === cur.recorded_on && e.created_at > cur.created_at)) newest.set(k, { recorded_on: e.recorded_on, created_at: e.created_at, value: Number(e.value) }) }
    const sumOf = (metric: string) => Array.from(newest.entries()).filter(([k]) => k.startsWith(metric + '|')).reduce((n, [, v]) => n + v.value, 0)
    const servedAll = sumOf('impressions'), clicksAll = sumOf('clicks'), asOf = Array.from(newest.values()).map((v) => v.recorded_on).sort().pop()!
    const ctr = servedAll > 0 ? Math.round((clicksAll / servedAll) * 10000) / 100 : null          // total clicks ÷ total impressions — NOT an average of the segments' rates
    let ctrAdded = 0
    if (ctr != null && !seen.has(`ctr||${asOf}|${ctr}`)) { const { error } = await svc.from('project_metrics').insert({ ...base, metric_key: 'ctr', segment: null, recorded_on: asOf, value: ctr }); if (error) throw new ApiError(400, error.message); ctrAdded = 1 }

    const planned = brandQty ?? d.planned_quantity
    let status: DeliveryStatus
    try { status = statusForQuantity(planned, servedAll, d.status as DeliveryStatus) } catch (e) { throw new ApiError(400, e instanceof Error ? e.message : 'Invalid quantity') }
    const patch: Record<string, unknown> = { delivered_quantity: servedAll, status, updated_at: new Date().toISOString() }
    if (brandQty != null) patch.planned_quantity = brandQty
    if (vendorQty != null) patch.vendor_quantity = vendorQty
    if (status !== 'missed') { patch.invoice_adjustment = false; patch.adjustment_note = null }
    const { error: ue } = await svc.from('deliverables').update(patch).eq('id', d.id)
    if (ue) throw new ApiError(400, ue.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'tracker_campaign_imported', entityType: 'deliverable', entityId: d.id, after: { project_id: target.project.id, readings: inserts.length + ctrAdded, served: servedAll, clicks: clicksAll, acknowledged_implausible: implausible.length > 0 } })
    return NextResponse.json({ readings_added: inserts.length + ctrAdded, segments: last.length, as_of: asOf, served: servedAll, clicks: clicksAll, ctr_pct: ctr, deliverable: { status, delivered_quantity: servedAll, planned_quantity: planned } }, { status: inserts.length + ctrAdded ? 201 : 200 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
