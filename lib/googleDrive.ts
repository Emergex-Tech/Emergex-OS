// Drive-only client (~3 MB) instead of the full `googleapis` bundle (~112 MB), which risks Vercel's function size limit.
import { drive as createDrive, type drive_v3 } from '@googleapis/drive'
import { GoogleAuth } from 'google-auth-library'
import { Readable } from 'stream'

// PRD 6.9: "One company Shared Drive is the only file store, with folders
// the app creates per vendor, brand, agent, property, proposal and
// contract... Nothing goes to personal Drives." A service account with
// Content Manager access on the Shared Drive means no per-user OAuth flow —
// every folder is owned by the organisation, not by whoever was signed in
// when it was created.

let _drive: drive_v3.Drive | null = null

function driveClient(): drive_v3.Drive {
  if (_drive) return _drive
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not set')
  const credentials = JSON.parse(raw)
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/drive'] })
  _drive = createDrive({ version: 'v3', auth })
  return _drive
}

const TYPE_FOLDER_NAMES: Record<string, string> = {
  vendor: 'Vendors',
  brand: 'Brands',
  agent: 'Agents',
  property: 'Properties',
  proposal: 'Proposals', // reserved, Stage 2A
  contract: 'Contracts', // reserved, Stage 2B
  project: 'Projects'    // proof files for live projects (Stage 3)
}

async function findOrCreateChildFolder(drive: drive_v3.Drive, name: string, parentId: string, sharedDriveId: string): Promise<string> {
  const existing = await drive.files.list({
    q: `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`,
    driveId: sharedDriveId,
    corpora: 'drive',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  })
  const found = existing.data.files?.[0]?.id
  if (found) return found

  const created = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
    supportsAllDrives: true
  })
  if (!created.data.id) throw new Error('Drive did not return a folder id')
  return created.data.id
}

/**
 * Creates (or reuses) the record's folder inside the right top-level
 * type folder — e.g. Vendors/Apex Sports Media. Returns the folder id and
 * a webViewLink. Throws on any Drive API failure — the caller decides
 * whether that should block the record creation or just get logged.
 */
export async function createRecordFolder(params: {
  entityType: keyof typeof TYPE_FOLDER_NAMES
  folderName: string
}): Promise<{ folderId: string; folderUrl: string | null }> {
  const sharedDriveId = process.env.GOOGLE_SHARED_DRIVE_ID
  if (!sharedDriveId) throw new Error('GOOGLE_SHARED_DRIVE_ID is not set')

  const drive = driveClient()
  const typeFolderName = TYPE_FOLDER_NAMES[params.entityType] || 'Other'
  const typeFolderId = await findOrCreateChildFolder(drive, typeFolderName, sharedDriveId, sharedDriveId)
  const recordFolderId = await findOrCreateChildFolder(drive, params.folderName, typeFolderId, sharedDriveId)

  const meta = await drive.files.get({ fileId: recordFolderId, fields: 'webViewLink', supportsAllDrives: true })
  return { folderId: recordFolderId, folderUrl: meta.data.webViewLink ?? null }
}

/**
 * Uploads a file into a Drive folder on the company Shared Drive (PRD 6.9: the
 * Shared Drive is the only file store). Throws on any Drive failure — the caller
 * decides whether that blocks anything (for exports it must not: the file is
 * still returned to the user and the failure is recorded).
 */
export async function uploadFileToFolder(params: {
  folderId: string
  name: string
  mimeType: string
  content: Buffer
}): Promise<{ fileId: string; webViewLink: string | null }> {
  const drive = driveClient()
  const created = await drive.files.create({
    requestBody: { name: params.name, parents: [params.folderId] },
    media: { mimeType: params.mimeType, body: Readable.from(params.content) },
    fields: 'id, webViewLink',
    supportsAllDrives: true
  })
  if (!created.data.id) throw new Error('Drive did not return a file id')
  return { fileId: created.data.id, webViewLink: created.data.webViewLink ?? null }
}

/** Read-only Drive access check for the /api/health diagnostic. Creates nothing. */
export async function checkDriveAccess(): Promise<{ ok: boolean; detail: string }> {
  try {
    const sharedDriveId = process.env.GOOGLE_SHARED_DRIVE_ID
    if (!sharedDriveId) return { ok: false, detail: 'GOOGLE_SHARED_DRIVE_ID is not set' }
    const drive = driveClient()
    await drive.files.list({
      corpora: 'drive', driveId: sharedDriveId, includeItemsFromAllDrives: true, supportsAllDrives: true, pageSize: 1, fields: 'files(id)'
    })
    return { ok: true, detail: 'Service account can read the Shared Drive' }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/** Reads a file's bytes through the service account, so nobody needs Drive access of their own to download one. */
export async function downloadFile(fileId: string): Promise<Buffer> {
  const drive = driveClient()
  const res = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' })
  return Buffer.from(res.data as unknown as ArrayBuffer)
}

/**
 * Every Drive operation the app performs goes through this object, so tests can swap in an in-memory
 * fake (see tests/e2e/run.ts). Production never reassigns it. This is injection, not a "fake mode"
 * switched on by an environment variable — a misconfigured production must never be able to store
 * contracts somewhere other than the real Shared Drive.
 */
export const driveImpl = { createRecordFolder, uploadFileToFolder, downloadFile }
