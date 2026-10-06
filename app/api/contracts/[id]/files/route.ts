import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit, ensureFolderId } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { driveImpl } from '@/lib/googleDrive'
import { validateUpload, sha256Hex, driveFileName, MAX_CONTRACT_FILE_BYTES } from '@/lib/contractFiles'
import { safeFilePart } from '@/lib/naming'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

export const runtime = 'nodejs'
export const maxDuration = 60

async function loadContract(orgId: string, id: string) {
  if (!isUuid(id)) throw new ApiError(404, 'Contract not found')
  const { data } = await supabaseService().from('contracts').select('id, deals(proposals(brands(name)))').eq('id', id).eq('org_id', orgId).maybeSingle()
  if (!data) throw new ApiError(404, 'Contract not found')
  return { id: data.id as string, brand: (data.deals as unknown as { proposals: { brands: { name: string } | null } | null } | null)?.proposals?.brands?.name ?? 'Brand' }
}

/** B3: every version of every document on a contract, newest first. contract.manage only — these can hold agent cuts. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'contract.manage')
    const contract = await loadContract(profile.org_id, params.id)
    const { data, error } = await supabaseService().from('files')
      .select('id, doc_title, version, is_current, name, size_bytes, mime_type, version_note, created_at, profiles(full_name)')
      .eq('org_id', profile.org_id).eq('linked_type', 'contract').eq('linked_id', contract.id).eq('kind', 'contract_file')
      .order('doc_title').order('version', { ascending: false })
    if (error) throw new ApiError(400, error.message)
    return NextResponse.json((data ?? []).map((f) => ({ ...f, uploaded_by: (f.profiles as unknown as { full_name: string } | null)?.full_name ?? null, profiles: undefined })))
  } catch (err) { return errorResponse(err) }
}

/**
 * Upload a document. Unlike a proposal EXPORT (which can be regenerated, so a Drive failure is tolerated), a contract
 * file exists nowhere else — so if Drive can't take it we refuse and save NOTHING rather than record a file we don't have.
 * Re-uploading identical bytes is a no-op, not a new version.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'contract.manage')
    const contract = await loadContract(profile.org_id, params.id)
    const form = await req.formData().catch(() => null)
    if (!form) throw new ApiError(400, 'Send the file as a form upload')
    const file = form.get('file')
    if (!(file instanceof File)) throw new ApiError(400, 'Choose a file')
    if (file.size > MAX_CONTRACT_FILE_BYTES) throw new ApiError(413, `The file is larger than ${MAX_CONTRACT_FILE_BYTES / 1024 / 1024} MB`)
    const title = String(form.get('title') ?? '').trim() || 'Contract'
    if (title.length > 80) throw new ApiError(400, 'The document title can be at most 80 characters')
    const note = String(form.get('note') ?? '').trim().slice(0, 500) || null

    const buffer = Buffer.from(await file.arrayBuffer())
    const check = validateUpload(file.name, buffer)
    if (!check.ok) throw new ApiError(400, check.reason)
    const hash = sha256Hex(buffer)
    const svc = supabaseService()

    const latest = async () => (await svc.from('files').select('id, version, is_current, sha256, name')
      .eq('org_id', profile.org_id).eq('linked_type', 'contract').eq('linked_id', contract.id).eq('kind', 'contract_file').eq('doc_title', title)
      .order('version', { ascending: false })).data ?? []
    let versions = await latest()
    const current = versions.find((v) => v.is_current)
    if (current?.sha256 === hash) return NextResponse.json({ duplicate: true, version: current.version, message: `Identical to the current version (v${current.version}); nothing was changed.` })

    const folderId = await ensureFolderId({ orgId: profile.org_id, actorId: profile.id, entityType: 'contract', entityId: contract.id, folderName: `${safeFilePart(contract.brand)} - contract - ${contract.id.slice(0, 8)}` })
    if (!folderId) throw new ApiError(502, 'Google Drive is not available, so the file was NOT saved. Nothing was recorded.')

    for (let attempt = 0; attempt < 3; attempt++) {
      const nextVersion = (versions[0]?.version ?? 0) + 1
      let uploaded
      try { uploaded = await driveImpl.uploadFileToFolder({ folderId, name: driveFileName(title, nextVersion, file.name), mimeType: check.mime, content: buffer }) }
      catch (e) {
        await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'contract_file_upload_failed', entityType: 'contract', entityId: contract.id, after: { error: e instanceof Error ? e.message : String(e) } })
        throw new ApiError(502, 'Google Drive rejected the upload, so the file was NOT saved. Nothing was recorded.')
      }
      const prev = versions.find((v) => v.is_current)
      if (prev) await svc.from('files').update({ is_current: false }).eq('id', prev.id)
      const { data: row, error } = await svc.from('files').insert({
        org_id: profile.org_id, linked_type: 'contract', linked_id: contract.id, kind: 'contract_file', doc_title: title, name: file.name,
        version: nextVersion, is_current: true, drive_file_id: uploaded.fileId, drive_folder_id: folderId, size_bytes: buffer.length,
        mime_type: check.mime, sha256: hash, version_note: note, uploaded_by: profile.id
      }).select('id, version').single()
      if (!error) {
        await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'contract_file_uploaded', entityType: 'contract', entityId: contract.id, after: { title, version: nextVersion, bytes: buffer.length } })
        return NextResponse.json({ id: row.id, version: row.version, duplicate: false }, { status: 201 })
      }
      if (prev) await svc.from('files').update({ is_current: true }).eq('id', prev.id) // put things back before retrying or failing
      if (error.code !== '23505') throw new ApiError(500, 'The file was uploaded to Drive but could not be recorded. Please try again.')
      versions = await latest() // someone else uploaded at the same moment: take the next free version number
    }
    throw new ApiError(409, 'Another upload was in progress. Please try again.')
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
