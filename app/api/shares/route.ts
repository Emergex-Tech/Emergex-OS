import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { createRecord } from '@/lib/serviceLayer'
import { checkConflicts, findUsableOverride, summarizeConflicts } from '@/lib/conflicts'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

// Stage 1 scope: log only. Conflict checking (already-shared-with-this-brand
// warnings) is explicitly a Stage 2A capability (6.10) — deliberately not
// built here, so as not to jump the sequence the PRD insists on.
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    if (!body.item_id || !body.brand_id) throw new ApiError(400, 'item_id and brand_id are required')

    // A21–A25: warn before sending. A share that already happened (pasted from a chat) can't be
    // blocked, only recorded with its conflict flagged; a share about to be sent needs an approved override.
    const routeId = body.route_id ?? null
    const conflicts = await checkConflicts({ orgId: profile.org_id, itemId: body.item_id, brandId: body.brand_id, routeId })
    let overrideId: string | null = null
    if (conflicts.length > 0 && !body.logged_after_the_fact) {
      const ov = await findUsableOverride({ orgId: profile.org_id, itemId: body.item_id, brandId: body.brand_id, routeId })
      if (!ov) {
        return NextResponse.json({
          error: 'This conflicts with an earlier share. A Manager/CEO-approved override is required before it can be sent.',
          conflicts
        }, { status: 409 })
      }
      overrideId = ov.id
    }

    const share = await createRecord({
      profile,
      permission: 'record.create',
      table: 'shares',
      entityType: 'share',
      data: {
        item_id: body.item_id,
        brand_id: body.brand_id,
        route_id: body.route_id ?? null,
        channel: body.channel ?? null,
        occurred_at: body.occurred_at ?? new Date().toISOString(),
        logged_after_the_fact: body.logged_after_the_fact ?? false,
        override_id: overrideId,
        conflict_summary: conflicts.length ? (body.logged_after_the_fact ? 'Logged after the fact — ' : '') + summarizeConflicts(conflicts) : null
      }
    })
    if (overrideId) {
      await supabaseService().from('share_conflict_overrides').update({ status: 'used', used_at: new Date().toISOString() }).eq('id', overrideId)
    }

    return NextResponse.json(share, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
