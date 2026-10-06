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

async function loadFile(orgId: string, contractId: string, fileId: string) {
  if (!isUuid(contractId) || !isUuid(fileId)) throw new ApiError(404, 'File not found')
  const { data } = await supabaseService().from('files').select('id, doc_title, version, is_current, name, drive_file_id, mime_type')
    .eq('id', fileId).eq('org_id', orgId).eq('linked_type', 'contract').eq('linked_id', contractId).eq('kind', 'contract_file').maybeSingle()
  if (!data) throw new ApiError(404, 'File not found')
  return data
}

/** Streams the file through the service account, so no one needs Drive access of their own. Forced to download, never rendered in-page. */
export async function GET(_req: NextRequest, { params }: { params: { id: string; fileId: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'contract.manage')
    const f = await loadFile(profile.org_id, params.id, params.fileId)
    if (!f.drive_file_id) throw new ApiError(404, 'File not found')
    let bytes: Buffer
    try { bytes = await driveImpl.downloadFile(f.drive_file_id) } catch { throw new ApiError(502, 'Google Drive could not provide this file right now') }
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'contract_file_downloaded', entityType: 'contract', entityId: params.id, after: { file_id: f.id, version: f.version } })
    const dot = (f.name ?? '').lastIndexOf('.')
    const ext = dot >= 0 ? (f.name as string).slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '') : ''
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers: {
      'Content-Type': f.mime_type ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeFilePart(f.doc_title ?? 'contract')}-v${f.version}${ext}"`,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store'
    } })
  } catch (err) { return errorResponse(err) }
}

/** { action: 'make_current' } — roll back to (or forward to) a particular version of that document. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; fileId: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'contract.manage')
    const body = await req.json().catch(() => ({}))
    if (body.action !== 'make_current') throw new ApiError(400, "action must be 'make_current'")
    const f = await loadFile(profile.org_id, params.id, params.fileId)
    if (f.is_current) return NextResponse.json({ ok: true, unchanged: true })
    const svc = supabaseService()
    await svc.from('files').update({ is_current: false }).eq('org_id', profile.org_id).eq('linked_type', 'contract').eq('linked_id', params.id).eq('kind', 'contract_file').eq('doc_title', f.doc_title).eq('is_current', true)
    const { error } = await svc.from('files').update({ is_current: true }).eq('id', f.id)
    if (error) throw new ApiError(500, 'Could not change the current version')
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'contract_file_made_current', entityType: 'contract', entityId: params.id, after: { file_id: f.id, version: f.version } })
    return NextResponse.json({ ok: true })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
