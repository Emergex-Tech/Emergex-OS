import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit, ensureFolderId } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { driveImpl } from '@/lib/googleDrive'
import { validateUpload, sha256Hex, driveFileName, MAX_CONTRACT_FILE_BYTES } from '@/lib/contractFiles'
import { parseDriveLink } from '@/lib/metrics'
import { safeFilePart } from '@/lib/naming'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

export const runtime = 'nodejs'
export const maxDuration = 60

const SELECT = 'id, kind, name, url, mime_type, size_bytes, note, created_at, adder:profiles!deliverable_proofs_added_by_fkey(full_name)'
const shape = (p: Record<string, unknown>) => ({ ...p, added_by_name: (p.adder as { full_name: string } | null)?.full_name ?? null, adder: undefined })

async function loadDeliverable(orgId: string, id: string) {
  if (!isUuid(id)) throw new ApiError(404, 'Deliverable not found')
  const { data } = await supabaseService().from('deliverables').select('id, description, status, contracts(deal_id)').eq('id', id).eq('org_id', orgId).maybeSingle()
  if (!data) throw new ApiError(404, 'Deliverable not found')
  const dealId = (data.contracts as unknown as { deal_id: string } | null)?.deal_id
  const { data: project } = dealId ? await supabaseService().from('projects').select('id, name, status').eq('deal_id', dealId).maybeSingle() : { data: null }
  return { ...data, project }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const d = await loadDeliverable(profile.org_id, params.id)
    const { data, error } = await supabaseService().from('deliverable_proofs').select(SELECT).eq('deliverable_id', d.id).is('archived_at', null).order('created_at', { ascending: false })
    if (error) throw new ApiError(500, error.message)
    return NextResponse.json((data ?? []).map(shape))
  } catch (err) { return errorResponse(err) }
}

/**
 * L11: attach proof — a FILE (sent as a form upload; stored in the project's Drive folder) or a LINK to an existing Drive file (sent as JSON {url}).
 * Like a contract file, an upload exists nowhere else: if Drive can't take it the request is refused and NOTHING is recorded.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    const d = await loadDeliverable(profile.org_id, params.id)
    if (d.status === 'replaced') throw new ApiError(400, 'This deliverable has been replaced by a make-good — attach proof to the make-good instead')
    if (d.project?.status === 'closed') throw new ApiError(409, 'This project is closed, so its delivery record is locked. Reopen the project to change it.') // before Drive is touched: no orphan file
    const svc = supabaseService()
    const isUpload = (req.headers.get('content-type') ?? '').includes('multipart/form-data')

    if (!isUpload) {
      const b = await req.json().catch(() => ({}))
      const link = parseDriveLink(b.url)
      if (!link.ok) throw new ApiError(400, link.reason)
      const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 200) : 'Drive file'
      const { data, error } = await svc.from('deliverable_proofs').insert({ org_id: profile.org_id, deliverable_id: d.id, kind: 'link', name, url: link.url, drive_file_id: null, note: typeof b.note === 'string' ? b.note.trim().slice(0, 500) || null : null, added_by: profile.id }).select(SELECT).single()
      if (error?.code === '23505') throw new ApiError(409, 'That link is already attached to this deliverable')
      if (error) throw new ApiError(400, error.message)
      await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'deliverable_proof_linked', entityType: 'deliverable', entityId: d.id, after: { proof_id: data.id } })
      return NextResponse.json(shape(data), { status: 201 })
    }

    if (!d.project) throw new ApiError(409, 'This deliverable\'s deal has no project yet, so there is no project folder to store the file in')
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) throw new ApiError(400, 'Choose a file')
    if (file.size > MAX_CONTRACT_FILE_BYTES) throw new ApiError(413, `The file is larger than ${MAX_CONTRACT_FILE_BYTES / 1024 / 1024} MB — put it in Drive and attach the link instead`)
    const buffer = Buffer.from(await file.arrayBuffer())
    const check = validateUpload(file.name, buffer)
    if (!check.ok) throw new ApiError(400, check.reason)
    const hash = sha256Hex(buffer)
    const note = String(form?.get('note') ?? '').trim().slice(0, 500) || null

    const { data: dup } = await svc.from('deliverable_proofs').select('id').eq('deliverable_id', d.id).eq('sha256', hash).is('archived_at', null).maybeSingle()
    if (dup) return NextResponse.json({ duplicate: true, id: dup.id, message: 'This exact file is already attached to this deliverable; nothing was changed.' })
    const folderId = await ensureFolderId({ orgId: profile.org_id, actorId: profile.id, entityType: 'project', entityId: d.project.id, folderName: `${safeFilePart(d.project.name)} - ${d.project.id.slice(0, 8)}` })
    if (!folderId) throw new ApiError(502, 'Google Drive is not available, so the file was NOT saved. Nothing was recorded.')
    const { count } = await svc.from('deliverable_proofs').select('id', { count: 'exact', head: true }).eq('deliverable_id', d.id)
    let uploaded
    try { uploaded = await driveImpl.uploadFileToFolder({ folderId, name: driveFileName(`${d.description} proof`, (count ?? 0) + 1, file.name), mimeType: check.mime, content: buffer }) }
    catch (e) {
      await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'deliverable_proof_upload_failed', entityType: 'deliverable', entityId: d.id, after: { error: e instanceof Error ? e.message : String(e) } })
      throw new ApiError(502, 'Google Drive rejected the upload, so the file was NOT saved. Nothing was recorded.')
    }
    const { data, error } = await svc.from('deliverable_proofs').insert({ org_id: profile.org_id, deliverable_id: d.id, kind: 'upload', name: file.name.slice(0, 200), drive_file_id: uploaded.fileId, drive_folder_id: folderId, mime_type: check.mime, size_bytes: buffer.length, sha256: hash, note, added_by: profile.id }).select(SELECT).single()
    if (error?.code === '23505') return NextResponse.json({ duplicate: true, message: 'This exact file is already attached to this deliverable; nothing was changed.' })
    if (error) throw new ApiError(500, 'The file was uploaded to Drive but could not be recorded. Please try again.')
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'deliverable_proof_uploaded', entityType: 'deliverable', entityId: d.id, after: { proof_id: data.id, bytes: buffer.length } })
    return NextResponse.json(shape(data), { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
