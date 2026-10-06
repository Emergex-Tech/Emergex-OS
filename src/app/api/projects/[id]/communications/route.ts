import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadOwnProject } from '@/lib/projectService'
import { summariseOpenRequests, waitingOn } from '@/lib/projects'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

const SELECT = 'id, party_id, direction, channel, kind, occurred_at, summary, related_type, related_id, status, waiting_on, resolved_at, resolution_note, created_at, creator:profiles!project_communications_created_by_fkey(full_name), party:project_parties(name, role)'

/** L29: the log (newest first) and who is waiting on whom. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const project = await loadOwnProject(profile.org_id, params.id)
    const sp = req.nextUrl.searchParams
    const svc = supabaseService()
    let q = svc.from('project_communications').select(SELECT).eq('project_id', project.id).order('occurred_at', { ascending: false }).limit(Math.min(Math.max(Number(sp.get('limit') ?? 100) || 100, 1), 200))
    const status = sp.get('status'); if (status) { if (!['open', 'done'].includes(status)) throw new ApiError(400, "status must be 'open' or 'done'"); q = q.eq('status', status) }
    const party = sp.get('party_id'); if (party) { if (!isUuid(party)) throw new ApiError(400, 'party_id is not valid'); q = q.eq('party_id', party) }
    const { data, error } = await q
    if (error) throw new ApiError(500, error.message)
    const { data: open } = await svc.from('project_communications').select('id, status, waiting_on, party_id, occurred_at, kind').eq('project_id', project.id).eq('status', 'open')
    return NextResponse.json({
      entries: (data ?? []).map((c) => ({ ...c, created_by_name: (c.creator as unknown as { full_name: string } | null)?.full_name ?? null, party_name: (c.party as unknown as { name: string } | null)?.name ?? null, creator: undefined, party: undefined })),
      requests: summariseOpenRequests(open ?? [])
    })
  } catch (err) { return errorResponse(err) }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.create')
    const project = await loadOwnProject(profile.org_id, params.id)
    const b = await req.json().catch(() => ({}))
    if (!['inbound', 'outbound'].includes(b.direction)) throw new ApiError(400, "direction must be 'inbound' or 'outbound'")
    if (!['whatsapp', 'telegram', 'email', 'call', 'meeting', 'other'].includes(b.channel)) throw new ApiError(400, 'channel is not valid')
    if (!['request', 'approval', 'update', 'proof', 'other'].includes(b.kind)) throw new ApiError(400, 'kind is not valid')
    const summary = typeof b.summary === 'string' ? b.summary.trim() : ''
    if (!summary || summary.length > 2000) throw new ApiError(400, 'A summary of 1–2000 characters is required')
    let occurredAt = new Date().toISOString()
    if (b.occurred_at != null) {
      const t = Date.parse(String(b.occurred_at))
      if (!Number.isFinite(t)) throw new ApiError(400, 'occurred_at is not a valid date')
      if (t > Date.now() + 86_400_000) throw new ApiError(400, 'occurred_at cannot be in the future')
      occurredAt = new Date(t).toISOString()
    }
    const svc = supabaseService()
    if (b.party_id != null) {
      if (!isUuid(b.party_id)) throw new ApiError(400, 'party_id is not valid')
      const { data: pty } = await svc.from('project_parties').select('id').eq('id', b.party_id).eq('project_id', project.id).is('archived_at', null).maybeSingle()
      if (!pty) throw new ApiError(400, 'That party is not on this project')
    }
    let relatedType: string | null = null, relatedId: string | null = null
    if (b.related_type != null || b.related_id != null) {
      if (!isUuid(b.related_id)) throw new ApiError(400, 'related_id is not valid')
      if (b.related_type === 'report') throw new ApiError(400, 'Reports arrive in a later release')
      if (b.related_type === 'checklist_item') {
        const { data: it } = await svc.from('project_checklist_items').select('id').eq('id', b.related_id).eq('project_id', project.id).maybeSingle()
        if (!it) throw new ApiError(400, 'That checklist item is not on this project')
      } else if (b.related_type === 'deliverable') {
        const { data: c } = await svc.from('contracts').select('id').eq('deal_id', project.deal_id).maybeSingle()
        const { data: d } = c ? await svc.from('deliverables').select('id').eq('id', b.related_id).eq('contract_id', c.id).maybeSingle() : { data: null }
        if (!d) throw new ApiError(400, 'That deliverable is not on this project')
      } else throw new ApiError(400, "related_type must be 'deliverable' or 'checklist_item'")
      relatedType = b.related_type; relatedId = b.related_id
    }
    const isRequest = b.kind === 'request'
    const { data, error } = await svc.from('project_communications').insert({
      org_id: profile.org_id, project_id: project.id, party_id: b.party_id ?? null, direction: b.direction, channel: b.channel, kind: b.kind, occurred_at: occurredAt, summary,
      related_type: relatedType, related_id: relatedId, status: isRequest ? 'open' : 'done', waiting_on: isRequest ? waitingOn(b.direction) : null, created_by: profile.id
    }).select(SELECT).single()
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'project_communication_logged', entityType: 'project', entityId: project.id, after: { entry_id: data.id, kind: b.kind, direction: b.direction } })
    return NextResponse.json({ ...data, created_by_name: profile.full_name, party_name: (data.party as unknown as { name: string } | null)?.name ?? null, creator: undefined, party: undefined }, { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
