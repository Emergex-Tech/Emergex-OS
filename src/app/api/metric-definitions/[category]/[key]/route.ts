import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

/** Rename, re-order or retire a metric. Retire (active:false) rather than delete: recorded entries keep their metric. */
export async function PATCH(req: NextRequest, { params }: { params: { category: string; key: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'project.template.manage')
    const b = await req.json().catch(() => ({}))
    const patch: Record<string, unknown> = {}
    if ('label' in b) { const l = typeof b.label === 'string' ? b.label.trim() : ''; if (!l || l.length > 80) throw new ApiError(400, 'A label of 1–80 characters is required'); patch.label = l }
    if ('unit' in b) { if (b.unit !== null && (typeof b.unit !== 'string' || b.unit.length > 20)) throw new ApiError(400, 'unit can be at most 20 characters'); patch.unit = b.unit || null }
    if ('aggregation' in b) { if (!['sum', 'avg'].includes(b.aggregation)) throw new ApiError(400, "aggregation must be 'sum' or 'avg'"); patch.aggregation = b.aggregation }
    if ('position' in b) { if (!Number.isInteger(b.position)) throw new ApiError(400, 'position must be a whole number'); patch.position = b.position }
    if ('active' in b) patch.active = b.active === true
    if (Object.keys(patch).length === 0) throw new ApiError(400, 'Nothing to change')
    const { data, error } = await supabaseService().from('metric_definitions').update(patch).eq('category_key', params.category).eq('key', params.key).select('*').maybeSingle()
    if (error) throw new ApiError(400, error.message)
    if (!data) throw new ApiError(404, 'Metric not found')
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'metric_definition_updated', entityType: 'metric_definition', entityId: profile.org_id, after: { category_key: params.category, key: params.key, ...patch } })
    return NextResponse.json(data)
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
