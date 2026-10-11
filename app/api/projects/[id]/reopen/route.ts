import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/** Unlocks a closed project. A reason is required and goes in the audit log; the renewal proposal and any case study are left as they are. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'project.manage')
    if (!isUuid(params.id)) throw new ApiError(404, 'Project not found')
    const body = await req.json().catch(() => ({}))
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (reason.length < 5) throw new ApiError(400, 'Say why you are reopening it (at least a few words)')
    if (reason.length > 1000) throw new ApiError(400, 'The reason can be at most 1000 characters')
    const svc = supabaseService()
    const { data: p } = await svc.from('projects').select('id, status').eq('id', params.id).eq('org_id', profile.org_id).maybeSingle()
    if (!p) throw new ApiError(404, 'Project not found')
    if (p.status !== 'closed') throw new ApiError(409, 'This project is not closed')
    const { error } = await svc.from('projects').update({ status: 'active', closed_at: null, closed_by: null, closure_note: null, closure_warnings: [], updated_at: new Date().toISOString() }).eq('id', p.id).eq('status', 'closed')
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'project_reopened', entityType: 'project', entityId: p.id, after: { reason } })
    return NextResponse.json({ reopened: true })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
