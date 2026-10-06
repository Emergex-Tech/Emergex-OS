import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, hasPermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { checkConflicts, overrideState, uniqueTypes } from '@/lib/conflicts'
import { errorResponse } from '@/lib/apiError'

/**
 * A25: "Warning override with Manager/CEO approval and reason."
 * Anyone building proposals can REQUEST an override (reason required); a Manager/CEO approves it.
 * A Manager/CEO's own request is approved on the spot (the reason is still recorded).
 * The server recomputes the conflicts itself — it never trusts what the client says was flagged.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.create')
    const body = await req.json().catch(() => ({}))
    const reason = String(body.reason ?? '').trim()
    if (!reason) throw new ApiError(400, 'A reason is required to override a share conflict')

    const svc = supabaseService()
    const { data: proposal } = await svc.from('proposals').select('id, brand_id, route_id').eq('id', params.id).eq('org_id', profile.org_id).single()
    if (!proposal) throw new ApiError(404, 'Proposal not found')

    const canApprove = await hasPermission(profile, 'share.override.approve')
    const { data: lines } = await svc.from('proposal_lines').select('id, item_id').eq('proposal_id', params.id)

    let created = 0, skipped = 0
    for (const l of lines ?? []) {
      const base = { orgId: profile.org_id, itemId: l.item_id, brandId: proposal.brand_id, routeId: proposal.route_id as string | null }
      const conflicts = await checkConflicts(base)
      if (conflicts.length === 0) continue
      const state = await overrideState(base)
      if (state === 'pending' || state === 'approved') { skipped++; continue } // already covered

      const { data: row, error } = await svc.from('share_conflict_overrides').insert({
        org_id: profile.org_id, proposal_id: params.id, item_id: l.item_id, brand_id: proposal.brand_id, route_id: proposal.route_id,
        conflict_types: uniqueTypes(conflicts), conflicts, reason,
        status: canApprove ? 'approved' : 'pending', requested_by: profile.id,
        decided_by: canApprove ? profile.id : null, decided_at: canApprove ? new Date().toISOString() : null
      }).select('id').single()
      if (error) throw new ApiError(400, error.message)

      await writeAudit({
        orgId: profile.org_id, actorId: profile.id, action: canApprove ? 'share_override_approved' : 'share_override_requested',
        entityType: 'share_conflict_override', entityId: row.id, after: { proposal_id: params.id, item_id: l.item_id, reason, conflict_types: uniqueTypes(conflicts) }
      })
      created++
    }
    if (created === 0 && skipped === 0) throw new ApiError(400, 'There are no conflicts on this proposal to override')
    return NextResponse.json({ created, already_covered: skipped, auto_approved: canApprove }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
