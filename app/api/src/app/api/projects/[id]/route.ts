import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadProjectDetail } from '@/lib/projectService'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    if (!isUuid(params.id)) throw new ApiError(404, 'Project not found')
    return NextResponse.json(await loadProjectDetail(profile.org_id, params.id))
  } catch (err) { return errorResponse(err) }
}

/** Rename, or assign the EmergeX owner (who must be a member of staff — never an agent). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'project.manage')
    if (!isUuid(params.id)) throw new ApiError(404, 'Project not found')
    const body = await req.json().catch(() => ({}))
    const svc = supabaseService()
    const patch: Record<string, unknown> = {}
    if ('name' in body) { const n = typeof body.name === 'string' ? body.name.trim() : ''; if (!n || n.length > 200) throw new ApiError(400, 'A name of 1–200 characters is required'); patch.name = n }
    if ('owner_id' in body) {
      if (!isUuid(body.owner_id)) throw new ApiError(400, 'owner_id is not valid')
      const { data: o } = await svc.from('profiles').select('id, full_name, roles(is_external)').eq('id', body.owner_id).eq('org_id', profile.org_id).maybeSingle()
      if (!o || (o.roles as unknown as { is_external: boolean } | null)?.is_external) throw new ApiError(400, 'The owner must be a member of staff')
      patch.owner_id = body.owner_id
    }
    if (Object.keys(patch).length === 0) throw new ApiError(400, 'Nothing to change')
    const { error, data } = await svc.from('projects').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', params.id).eq('org_id', profile.org_id).select('id').maybeSingle()
    if (error) throw new ApiError(400, error.message)
    if (!data) throw new ApiError(404, 'Project not found')
    if (patch.owner_id) {   // keep the "EmergeX owner" party in step with the owner
      const { data: o } = await svc.from('profiles').select('full_name').eq('id', patch.owner_id as string).single()
      await svc.from('project_parties').update({ name: o?.full_name ?? 'Unassigned', ref_id: patch.owner_id }).eq('project_id', params.id).eq('role', 'emergex_owner').is('archived_at', null)
    }
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'project_updated', entityType: 'project', entityId: params.id, after: patch })
    return NextResponse.json(await loadProjectDetail(profile.org_id, params.id))
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
