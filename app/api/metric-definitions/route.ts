import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

export async function GET() {
  try {
    await requireProfile()
    const { data, error } = await supabaseService().from('metric_definitions').select('category_key, key, label, unit, aggregation, position, active').order('category_key').order('position')
    if (error) throw new ApiError(500, error.message)
    return NextResponse.json(data ?? [])
  } catch (err) { return errorResponse(err) }
}

/** D15 (the metric set per category) is undecided in the PRD, so the sets are editable data. Adding a metric affects nothing already recorded. */
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'project.template.manage')
    const b = await req.json().catch(() => ({}))
    const svc = supabaseService()
    const { data: cat } = await svc.from('categories').select('key').eq('key', String(b.category_key ?? '')).maybeSingle()
    if (!cat) throw new ApiError(400, 'That category does not exist')
    if (typeof b.key !== 'string' || !/^[a-z0-9_]{1,40}$/.test(b.key)) throw new ApiError(400, 'key must be 1–40 lowercase letters, digits or underscores')
    const label = typeof b.label === 'string' ? b.label.trim() : ''
    if (!label || label.length > 80) throw new ApiError(400, 'A label of 1–80 characters is required')
    if (b.unit != null && (typeof b.unit !== 'string' || b.unit.length > 20)) throw new ApiError(400, 'unit can be at most 20 characters')
    const aggregation = b.aggregation ?? 'sum'
    if (!['sum', 'avg'].includes(aggregation)) throw new ApiError(400, "aggregation must be 'sum' (counts) or 'avg' (rates)")
    const { data: last } = await svc.from('metric_definitions').select('position').eq('category_key', b.category_key).order('position', { ascending: false }).limit(1)
    const { data, error } = await svc.from('metric_definitions').insert({ category_key: b.category_key, key: b.key, label, unit: b.unit || null, aggregation, position: Number.isInteger(b.position) ? b.position : (last?.[0]?.position ?? 0) + 10 }).select('*').single()
    if (error?.code === '23505') throw new ApiError(409, 'That category already has a metric with that key')
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'metric_definition_added', entityType: 'metric_definition', entityId: profile.org_id, after: { category_key: b.category_key, key: b.key } })
    return NextResponse.json(data, { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
