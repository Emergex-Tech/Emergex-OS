import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadClosureFacts, ensureRenewalProposal } from '@/lib/projectService'
import { closureIssues, closureDecision } from '@/lib/closure'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/**
 * L22. Closing is a decision the system RECORDS, not a gate it enforces silently: with open items it needs an explicit
 * acknowledgement and a written reason, and the list of what was open is stored on the project. The renewal proposal is
 * created first (one per project, safe to repeat), then the project is closed — which locks its delivery record in the database.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'project.manage')
    if (!isUuid(params.id)) throw new ApiError(404, 'Project not found')
    const body = await req.json().catch(() => ({}))
    const svc = supabaseService()
    const { data: p } = await svc.from('projects').select('id, name, status, deal_id').eq('id', params.id).eq('org_id', profile.org_id).maybeSingle()
    if (!p) throw new ApiError(404, 'Project not found')
    if (p.status === 'closed') throw new ApiError(409, 'This project is already closed')

    const issues = closureIssues(await loadClosureFacts(profile.org_id, p.id, p.deal_id))
    const decision = closureDecision(issues, body.acknowledge, body.note)
    if (!decision.ok) return NextResponse.json({ error: decision.error, issues, requires_acknowledgement: issues.length > 0 }, { status: 409 })

    const renewal = await ensureRenewalProposal(profile, p)
    const { data: closed, error } = await svc.from('projects')
      .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: profile.id, closure_note: decision.note, closure_warnings: issues, updated_at: new Date().toISOString() })
      .eq('id', p.id).eq('status', 'active').select('id').maybeSingle()
    if (error) throw new ApiError(400, error.message)
    if (!closed) throw new ApiError(409, 'This project was closed by someone else a moment ago')
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'project_closed', entityType: 'project', entityId: p.id, after: { issues: issues.map((i) => i.code), note: decision.note, renewal_proposal_id: renewal.id } })
    return NextResponse.json({ closed: true, renewal_proposal_id: renewal.id, renewal_created: renewal.created, issues })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
