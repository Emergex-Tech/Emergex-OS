import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '@/lib/supabaseServer'
import { driveImpl } from '@/lib/googleDrive'
import { resolveLink, logView, notFound, PUBLIC_HEADERS } from '@/lib/reportPublic'
import { safeFilePart } from '@/lib/naming'
import { isUuid } from '@/lib/ids'

export const runtime = 'nodejs'
export const maxDuration = 60
const INLINE = new Set(['image/png', 'image/jpeg'])

/**
 * An uploaded proof file, served ONLY if: the link is active, the proof belongs to THIS link's project, someone ticked "show to the
 * brand", it is not archived, and it is an uploaded file. Re-checked on every request, so hiding or archiving a proof takes effect at once.
 */
export async function GET(req: NextRequest, { params }: { params: { token: string; proofId: string } }) {
  try {
    const hit = await resolveLink(params.token); if (!hit || !isUuid(params.proofId)) return notFound()
    const svc = supabaseService()
    const { data: p } = await svc.from('deliverable_proofs').select('id, kind, name, drive_file_id, mime_type, report_visible, archived_at, deliverable_id').eq('id', params.proofId).eq('org_id', hit.link.org_id).maybeSingle()
    if (!p || p.report_visible !== true || p.archived_at || p.kind !== 'upload' || !p.drive_file_id) return notFound()
    const { data: d } = await svc.from('deliverables').select('contract_id').eq('id', p.deliverable_id).maybeSingle()
    const { data: c } = d ? await svc.from('contracts').select('deal_id').eq('id', d.contract_id).maybeSingle() : { data: null }
    if (!c || c.deal_id !== hit.project.deal_id) return notFound()      // another project's proof, even with a valid link
    if (!(await logView(hit, req, { kind: 'proof', proofId: p.id }))) return notFound()
    const bytes = await driveImpl.downloadFile(p.drive_file_id)
    const mime = INLINE.has(p.mime_type ?? '') ? (p.mime_type as string) : 'application/octet-stream'
    const dot = p.name.lastIndexOf('.'); const ext = dot >= 0 ? p.name.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '') : ''
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers: { ...PUBLIC_HEADERS, 'Content-Type': mime, 'Content-Disposition': `${INLINE.has(mime) ? 'inline' : 'attachment'}; filename="${safeFilePart(dot >= 0 ? p.name.slice(0, dot) : p.name) || 'proof'}${ext}"` } })
  } catch { return notFound() }
}
export const dynamic = 'force-dynamic'
