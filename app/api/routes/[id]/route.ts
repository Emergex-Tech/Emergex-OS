import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

const VALID_METHODS = ['onTop', 'outOf', 'fixedFee', 'none']

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    if (body.cut_method && !VALID_METHODS.includes(body.cut_method)) {
      throw new ApiError(400, `cut_method must be one of ${VALID_METHODS.join(', ')}`)
    }

    await requirePermission(profile, 'margin.set') // same gate as the agent-level default — this is a pricing input
    const svc = supabaseService()

    const { data: before } = await svc.from('routes').select('*').eq('id', params.id).single()
    const { data: after, error } = await svc
      .from('routes')
      .update({
        // Explicit null clears the override back to "use the agent's default" —
        // an empty string from a form field is treated as "clear," not "set to empty."
        cut_method: body.cut_method || null,
        cut_pct: body.cut_pct === '' || body.cut_pct == null ? null : Number(body.cut_pct),
        fixed_fee: body.fixed_fee === '' || body.fixed_fee == null ? null : Number(body.fixed_fee),
        updated_at: new Date().toISOString()
      })
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .select()
      .single()

    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'update', entityType: 'route', entityId: params.id, before, after })

    return NextResponse.json(after)
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
