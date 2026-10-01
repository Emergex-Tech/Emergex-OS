import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

/** B2: deliverables with dates and owners. Adding/editing the plan is contract.manage (Manager/CEO); marking them done is a separate, looser permission — see /api/deliverables/[id]. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'contract.manage')
    const body = await req.json()
    if (!body.description?.trim()) throw new ApiError(400, 'description is required')

    const svc = supabaseService()
    const { data: contract } = await svc.from('contracts').select('id').eq('id', params.id).eq('org_id', profile.org_id).single()
    if (!contract) throw new ApiError(404, 'Contract not found')

    const { data: deliverable, error } = await svc.from('deliverables').insert({
      org_id: profile.org_id, contract_id: params.id, description: body.description.trim(),
      due_date: body.due_date || null, owner_id: body.owner_id || null, created_by: profile.id
    }).select().single()
    if (error) throw new ApiError(400, error.message)

    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'deliverable_created', entityType: 'deliverable', entityId: deliverable.id, after: { contract_id: params.id } })
    return NextResponse.json(deliverable, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

export const dynamic = 'force-dynamic'
