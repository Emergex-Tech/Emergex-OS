import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadImportTarget } from '@/lib/tracker/service'
import { isValidIsoDate } from '@/lib/billing'
import { errorResponse } from '@/lib/apiError'

const MAX_ROWS = 200
/**
 * Step 2 of a deliverables-list import: create the reviewed deliverables on the project's contract. Manager/CEO (it sets what was
 * sold). All rows are validated first — one bad row means nothing is created. A deliverable that already exists on the contract
 * with the same wording and period is skipped, so importing the same list twice does not double it.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params   // Next 15+: route params arrive as a Promise
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'contract.manage')
    const target = await loadImportTarget(profile.org_id, params.id)
    if (!target.contractId) throw new ApiError(409, 'This project has no contract yet — create the contract first, then import its deliverables')
    const b = await req.json().catch(() => ({}))
    if (!Array.isArray(b.deliverables) || b.deliverables.length === 0) throw new ApiError(400, 'There is nothing to import')
    if (b.deliverables.length > MAX_ROWS) throw new ApiError(400, `At most ${MAX_ROWS} deliverables at a time`)
    const rows: Record<string, unknown>[] = [], rejected: { index: number; error: string }[] = []
    b.deliverables.forEach((x: Record<string, unknown>, index: number) => {
      try {
        if (!x || typeof x !== 'object') throw new Error('Not a valid row')
        const description = typeof x.description === 'string' ? x.description.trim() : ''
        if (!description || description.length > 300) throw new Error('needs a description of 1–300 characters')
        const planned = x.planned_quantity == null ? 1 : Number(x.planned_quantity)
        if (!Number.isFinite(planned) || planned <= 0 || planned > 1e9) throw new Error('the quantity must be greater than zero')
        if (x.unit != null && (typeof x.unit !== 'string' || x.unit.length > 40)) throw new Error('the unit is longer than 40 characters')
        const period = typeof x.period_label === 'string' ? x.period_label.trim() : ''
        if (period.length > 40) throw new Error('the period is longer than 40 characters')
        if (x.due_date != null && x.due_date !== '' && (typeof x.due_date !== 'string' || !isValidIsoDate(x.due_date))) throw new Error('the due date is not a valid date')
        rows.push({ description, planned_quantity: Math.round(planned * 100) / 100, unit: typeof x.unit === 'string' && x.unit.trim() ? x.unit.trim() : null, period_label: period || null, due_date: x.due_date || null })
      } catch (err) { rejected.push({ index, error: err instanceof Error ? err.message : String(err) }) }
    })
    if (rejected.length) return NextResponse.json({ error: `${rejected.length} ${rejected.length === 1 ? 'row is' : 'rows are'} not valid, so nothing was created`, rejected }, { status: 400 })
    const key = (d: { description: unknown; period_label?: unknown }) => `${String(d.description).trim().toLowerCase()}|${String(d.period_label ?? '').trim().toLowerCase()}`
    const have = new Set(target.deliverables.map((d) => key(d)))
    const fresh: Record<string, unknown>[] = []; let skipped = 0
    for (const r of rows) { if (have.has(key(r as { description: string }))) { skipped++; continue } have.add(key(r as { description: string })); fresh.push({ ...r, org_id: profile.org_id, contract_id: target.contractId, created_by: profile.id }) }
    if (fresh.length) { const { error } = await supabaseService().from('deliverables').insert(fresh); if (error) throw new ApiError(400, error.message) }
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'tracker_deliverables_imported', entityType: 'project', entityId: target.project.id, after: { created: fresh.length, skipped_existing: skipped } })
    return NextResponse.json({ created: fresh.length, skipped_existing: skipped }, { status: fresh.length ? 201 : 200 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
