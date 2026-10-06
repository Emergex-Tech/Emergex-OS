import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { driveImpl } from '@/lib/googleDrive'
import { safeFilePart } from '@/lib/naming'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

export const runtime = 'nodejs'
export const maxDuration = 60

async function loadProof(orgId: string, deliverableId: string, proofId: string) {
  if (!isUuid(deliverableId) || !isUuid(proofId)) throw new ApiError(404, 'Proof not found')
  const { data } = await supabaseService().from('deliverable_proofs').select('id, kind, name, drive_file_id, mime_type').eq('id', proofId).eq('deliverable_id', deliverableId).eq('org_id', orgId).is('archived_at', null).maybeSingle()
  if (!data) throw new ApiError(404, 'Proof not found')
  return data
}

/** Streams an UPLOADED proof through the service account, forced to download (never rendered in-page). A link is opened in Drive by the person's own Google access. */
export async function GET(_req: NextRequest, { params }: { params: { id: string; proofId: string } }) {
  try {
    const profile = await requireProfile()
    const p = await loadProof(profile.org_id, params.id, params.proofId)
    if (p.kind !== 'upload' || !p.drive_file_id) throw new ApiError(400, 'This proof is a link — open it in Google Drive')
    let bytes: Buffer
    try { bytes = await driveImpl.downloadFile(p.drive_file_id) } catch { throw new ApiError(502, 'Google Drive could not provide this file right now') }
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'deliverable_proof_downloaded', entityType: 'deliverable', entityId: params.id, after: { proof_id: p.id } })
    const dot = p.name.lastIndexOf('.'); const ext = dot >= 0 ? p.name.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '') : ''
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers: { 'Content-Type': p.mime_type ?? 'application/octet-stream', 'Content-Disposition': `attachment; filename="${safeFilePart(dot >= 0 ? p.name.slice(0, dot) : p.name)}${ext}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } })
  } catch (err) { return errorResponse(err) }
}

/** Archive, never delete — the file stays in Drive and the row stays for the audit trail. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; proofId: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    const p = await loadProof(profile.org_id, params.id, params.proofId)
    const { error } = await supabaseService().from('deliverable_proofs').update({ archived_at: new Date().toISOString(), archived_by: profile.id }).eq('id', p.id)
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'deliverable_proof_archived', entityType: 'deliverable', entityId: params.id, after: { proof_id: p.id } })
    return NextResponse.json({ ok: true })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
