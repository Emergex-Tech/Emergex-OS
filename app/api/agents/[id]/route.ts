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

    // Agent cut structure feeds directly into the margin stack (PRD 6.6),
    // so it sits behind the same permission as setting a margin.
    await requirePermission(profile, 'margin.set')
    const svc = supabaseService()

    const { data: before } = await svc.from('agents').select('*').eq('id', params.id).single()
    const { data: after, error } = await svc
      .from('agents')
      .update({ cut_method: body.cut_method, cut_pct: body.cut_pct ?? 0, fixed_fee: body.fixed_fee ?? 0 })
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .select()
      .single()

    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'update', entityType: 'agent', entityId: params.id, before, after })

    return NextResponse.json(after)
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
