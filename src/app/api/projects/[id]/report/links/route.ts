import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadReportProject } from '@/lib/reportAdmin'
import { assembleReport } from '@/lib/reportService'
import { newToken, hashToken, parseExpiryDays, linkState } from '@/lib/reportToken'
import { errorResponse } from '@/lib/apiError'

const MAX_ACTIVE_LINKS = 20

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const project = await loadReportProject(profile.org_id, params.id)
    const svc = supabaseService()
    const { data: links } = await svc.from('report_links').select('id, label, created_at, expires_at, revoked_at, creator:profiles!report_links_created_by_fkey(full_name)').eq('project_id', project.id).order('created_at', { ascending: false }).limit(200)
    const ids = (links ?? []).map((l) => l.id)
    const { data: views } = ids.length ? await svc.from('report_views').select('link_id, viewed_at').in('link_id', ids).order('viewed_at', { ascending: false }).limit(10000) : { data: [] }
    const stat = new Map<string, { n: number; last: string }>(); for (const v of views ?? []) { const s = stat.get(v.link_id) ?? { n: 0, last: v.viewed_at }; s.n++; stat.set(v.link_id, s) }
    return NextResponse.json({ links_released: process.env.REPORT_LINKS_ENABLED === '1', links: (links ?? []).map((l) => ({ id: l.id, label: l.label, created_at: l.created_at, expires_at: l.expires_at, revoked_at: l.revoked_at, state: linkState(l), created_by_name: (l.creator as unknown as { full_name: string } | null)?.full_name ?? null, views: stat.get(l.id)?.n ?? 0, last_viewed_at: stat.get(l.id)?.last ?? null })) })
  } catch (err) { return errorResponse(err) }
}

/**
 * Creates a read-only link. The token is shown ONCE (here) and never stored — only its SHA-256. Refused unless external links
 * have been released, and refused while the report would show a forbidden name (a vendor or delivery-side agent, D18).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'project.manage')
    const project = await loadReportProject(profile.org_id, params.id)
    if (process.env.REPORT_LINKS_ENABLED !== '1') throw new ApiError(409, 'External report links have not been released yet (REPORT_LINKS_ENABLED). Complete the security review first.')
    const b = await req.json().catch(() => ({}))
    const exp = parseExpiryDays(b.expires_in_days); if (!exp.ok) throw new ApiError(400, exp.error)
    const label = typeof b.label === 'string' ? b.label.trim() : ''
    if (b.label != null && (label.length < 1 || label.length > 120)) throw new ApiError(400, 'A label must be 1–120 characters')
    const { leaks } = await assembleReport(profile.org_id, project)
    if (leaks.length) return NextResponse.json({ error: `This report still contains names that must stay internal: ${leaks.join(', ')}. Edit the deliverable or proof wording first.`, leaks }, { status: 409 })
    const svc = supabaseService()
    const { data: existing } = await svc.from('report_links').select('expires_at, revoked_at').eq('project_id', project.id)
    if ((existing ?? []).filter((l) => linkState(l) === 'active').length >= MAX_ACTIVE_LINKS) throw new ApiError(409, `This project already has ${MAX_ACTIVE_LINKS} active links — revoke some first`)
    const token = newToken()
    const { data, error } = await svc.from('report_links').insert({ org_id: profile.org_id, project_id: project.id, token_hash: hashToken(token), label: label || null, created_by: profile.id, expires_at: new Date(Date.now() + exp.days * 86_400_000).toISOString() }).select('id, expires_at').single()
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'report_link_created', entityType: 'project', entityId: project.id, after: { link_id: data.id, days: exp.days } })   // the token is never logged
    return NextResponse.json({ id: data.id, token, url: `${req.nextUrl.origin}/r/${token}`, expires_at: data.expires_at, note: 'Copy this link now — it cannot be shown again.' }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
