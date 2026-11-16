import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from './supabaseServer'
import { hashToken, isPlausibleToken, linkState, ipHash, firstForwardedIp } from './reportToken'
import { REPORT_KEYS, type Report } from './reportBuilder'
import type { ReportProject } from './reportService'

/** The release switch. Until it is "1", every public report route answers exactly like an unknown link. */
export const reportLinksEnabled = () => process.env.REPORT_LINKS_ENABLED === '1'
export const PUBLIC_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Cross-Origin-Resource-Policy': 'same-origin'
}
/** ONE answer for every failure — unknown, malformed, expired, revoked, switched off, blocked, or broken — so a visitor learns nothing about which. */
export const notFound = () => NextResponse.json({ error: 'This link is not valid or has expired' }, { status: 404, headers: PUBLIC_HEADERS })

export interface ResolvedLink { link: { id: string; org_id: string; project_id: string; expires_at: string }; project: ReportProject }
/** Looks the link up on EVERY request (so revoking is immediate) by the hash of the token; the token itself is never stored or logged. */
export async function resolveLink(token: unknown): Promise<ResolvedLink | null> {
  if (!reportLinksEnabled() || !isPlausibleToken(token)) return null
  const svc = supabaseService()
  const { data: link } = await svc.from('report_links').select('id, org_id, project_id, expires_at, revoked_at').eq('token_hash', hashToken(token)).maybeSingle()
  if (!link || linkState(link) !== 'active') return null
  const { data: project } = await svc.from('projects').select('id, name, deal_id, status').eq('id', link.project_id).eq('org_id', link.org_id).maybeSingle()
  return project ? { link: { id: link.id, org_id: link.org_id, project_id: link.project_id, expires_at: link.expires_at }, project } : null
}
/** Logs the view BEFORE anything is served. Returns false if it could not be logged — and then nothing is served (fail closed). */
export async function logView(r: ResolvedLink, req: NextRequest, v: { kind: 'report' | 'snapshot' | 'proof' | 'pdf'; snapshotId?: string; proofId?: string }): Promise<boolean> {
  const { error } = await supabaseService().from('report_views').insert({
    org_id: r.link.org_id, link_id: r.link.id, kind: v.kind, snapshot_id: v.snapshotId ?? null, proof_id: v.proofId ?? null,
    ip_hash: ipHash(firstForwardedIp(req.headers.get('x-forwarded-for')), r.link.id), user_agent: (req.headers.get('user-agent') ?? '').slice(0, 200) || null
  })
  return !error
}
/** A stored snapshot is only served if it still has exactly the allow-listed shape. */
/** Compared as a SET of keys: Postgres stores JSON as jsonb, which does not keep key order, so a stored snapshot comes back re-ordered. */
export const isReportShape = (c: unknown): c is Report => !!c && typeof c === 'object' && !Array.isArray(c) && JSON.stringify(Object.keys(c as object).sort()) === JSON.stringify([...REPORT_KEYS].sort())
