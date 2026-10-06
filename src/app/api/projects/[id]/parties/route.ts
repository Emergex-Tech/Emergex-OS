import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadOwnProject, loadProjectDetail } from '@/lib/projectService'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

const SIDE_FOR_ROLE: Record<string, string> = { brand: 'brand', brand_route: 'brand', emergex_owner: 'emergex', delivery_agent: 'delivery', vendor: 'delivery', talent: 'delivery' }

/** L28: add a party to the chain. The side follows from the role (brand / delivery / EmergeX), except for 'other'. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    const project = await loadOwnProject(profile.org_id, params.id)
    const body = await req.json().catch(() => ({}))
    if (![...Object.keys(SIDE_FOR_ROLE), 'other'].includes(body.role)) throw new ApiError(400, 'role is not valid')
    const side = body.role === 'other' ? body.side : SIDE_FOR_ROLE[body.role]
    if (!['brand', 'delivery', 'emergex'].includes(side)) throw new ApiError(400, "side must be 'brand', 'delivery' or 'emergex'")
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 200) throw new ApiError(400, 'A name of 1–200 characters is required')
    if (body.ref_id != null && (!isUuid(body.ref_id) || !['brand', 'agent', 'vendor', 'profile'].includes(body.ref_type))) throw new ApiError(400, 'ref_type and ref_id must go together and be valid')
    const { error, data } = await supabaseService().from('project_parties').insert({
      org_id: profile.org_id, project_id: project.id, role: body.role, side, name,
      ref_type: body.ref_id ? body.ref_type : null, ref_id: body.ref_id ?? null, contact: typeof body.contact === 'string' ? body.contact.slice(0, 300) : null, notes: typeof body.notes === 'string' ? body.notes.slice(0, 1000) : null
    }).select('id').single()
    if (error?.code === '23505') throw new ApiError(409, 'That party is already on this project in that role')
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'project_party_added', entityType: 'project', entityId: project.id, after: { party_id: data.id, role: body.role, name } })
    return NextResponse.json(await loadProjectDetail(profile.org_id, project.id), { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
