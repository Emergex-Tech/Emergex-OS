import crypto from 'node:crypto'
import { safeFilePart } from './naming'

export const MAX_CONTRACT_FILE_BYTES = 4 * 1024 * 1024 // Vercel functions accept ~4.5 MB request bodies; larger needs a direct-to-Drive upload.

const zip = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
const ole = (b: Buffer) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
const TYPES: Record<string, { mime: string; magic: (b: Buffer) => boolean }> = {
  pdf: { mime: 'application/pdf', magic: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: zip },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: zip },
  doc: { mime: 'application/msword', magic: ole },
  xls: { mime: 'application/vnd.ms-excel', magic: ole },
  png: { mime: 'image/png', magic: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpg: { mime: 'image/jpeg', magic: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mime: 'image/jpeg', magic: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }
}

export type UploadCheck = { ok: true; ext: string; mime: string } | { ok: false; reason: string }

/** Checks the extension is one we accept AND that the bytes really are that kind of file — a renamed .exe is not a .pdf. */
export function validateUpload(filename: string, buffer: Buffer): UploadCheck {
  if (buffer.length === 0) return { ok: false, reason: 'The file is empty' }
  if (buffer.length > MAX_CONTRACT_FILE_BYTES) return { ok: false, reason: `The file is larger than ${MAX_CONTRACT_FILE_BYTES / 1024 / 1024} MB` }
  const dot = filename.lastIndexOf('.')
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
  const type = TYPES[ext]
  if (!type) return { ok: false, reason: `.${ext || '(none)'} files are not accepted. Allowed: ${Object.keys(TYPES).join(', ')}` }
  if (!type.magic(buffer)) return { ok: false, reason: `This does not look like a real .${ext} file` }
  return { ok: true, ext, mime: type.mime }
}

export const sha256Hex = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex')

/** The name stored in Drive: version first, so the chain reads in order, and ASCII-only so no path tricks survive. */
export function driveFileName(title: string, version: number, original: string): string {
  const dot = original.lastIndexOf('.')
  const ext = dot >= 0 ? original.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '') : ''
  const base = dot >= 0 ? original.slice(0, dot) : original
  return `${safeFilePart(title)} v${version} - ${safeFilePart(base)}${ext}`
}
