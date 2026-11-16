import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { createRecord, tryCreateDriveFolder } from '@/lib/serviceLayer'
import { proposalFolderName } from '@/lib/naming'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

// PRD 4: "build proposals from 2A" is explicitly a Team capability — so
// permission here is record.create, same as everything else Team builds.
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    if (!body.brand_id) throw new ApiError(400, 'brand_id is required')

    const proposal = await createRecord({
      profile,
      permission: 'record.create',
      table: 'proposals',
      entityType: 'proposal',
      data: {
        brand_id: body.brand_id,
        route_id: body.route_id ?? null,
        contact_id: body.contact_id ?? null,
        brief: body.brief ?? null,
        budget: body.budget ?? null,
        currency: body.currency ?? 'USD',
        markets: body.markets ?? null,
        event_start: body.event_start || null,
        event_end: body.event_end || null,
        stage: 'Draft'
      }
    })

    // PRD 6.9: the app creates a folder per proposal. Best effort — never blocks or fails the proposal.
    const { data: brand } = await supabaseService().from('brands').select('name').eq('id', body.brand_id).single()
    await tryCreateDriveFolder({
      orgId: profile.org_id, actorId: profile.id, entityType: 'proposal', entityId: proposal.id,
      folderName: proposalFolderName(brand?.name ?? 'Brand', proposal.created_at, proposal.id)
    })

    return NextResponse.json(proposal, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function GET() {
  try {
    const profile = await requireProfile()
    const svc = supabaseService()
    const { data, error } = await svc
      .from('proposals')
      .select('id, stage, brief, budget, currency, created_at, brands(name), routes(route_type, agents(name))')
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false })

    if (error) throw new ApiError(400, error.message)
    return NextResponse.json(data)
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
