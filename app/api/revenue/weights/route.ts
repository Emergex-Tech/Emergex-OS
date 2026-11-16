import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadWeights } from '@/lib/revenueService'
import { OPEN_STAGES } from '@/lib/revenue'
import { errorResponse } from '@/lib/apiError'

/** How likely a proposal at each open stage is to be won — the forecast's weights. CEO only. {weights: {Sent: 60, …}} sets only the stages given. */
export async function PUT(req: NextRequest) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'revenue.plan')
    const b = await req.json().catch(() => ({}))
    if (!b.weights || typeof b.weights !== 'object' || Array.isArray(b.weights) || Object.keys(b.weights).length === 0) throw new ApiError(400, 'Give the weights to change, e.g. {"weights": {"Sent": 60}}')
    const rows = Object.entries(b.weights as Record<string, unknown>).map(([stage, v]) => {
      if (!(OPEN_STAGES as readonly string[]).includes(stage)) throw new ApiError(400, `"${stage}" is not an open stage (${OPEN_STAGES.join(', ')})`)
      const pct = Number(v)
      if (v === '' || v == null || typeof v === 'boolean' || !Number.isFinite(pct) || pct < 0 || pct > 100) throw new ApiError(400, `The weight for ${stage} must be between 0 and 100`)
      return { org_id: profile.org_id, stage, weight_pct: Math.round(pct * 100) / 100, set_by: profile.id, updated_at: new Date().toISOString() }
    })
    const { error } = await supabaseService().from('pipeline_stage_weights').upsert(rows, { onConflict: 'org_id,stage' })
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'pipeline_weights_set', entityType: 'organisation', entityId: profile.org_id, after: Object.fromEntries(rows.map((r) => [r.stage, r.weight_pct])) })
    return NextResponse.json({ weights: await loadWeights(profile.org_id) })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
