import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit, ensureFolderId } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { findUnpricedLines } from '@/lib/proposalGate'
import { getOrCreateVersion } from '@/lib/proposalVersions'
import { buildProposalWorkbook, type ExportData } from '@/lib/proposalExcel'
import { uploadFileToFolder } from '@/lib/googleDrive'
import { proposalFolderName, safeFilePart } from '@/lib/naming'
import { checkConflicts, findUsableOverride, summarizeConflicts, type Conflict } from '@/lib/conflicts'
import { errorResponse } from '@/lib/apiError'

export const runtime = 'nodejs' // exceljs needs Node APIs

// Approval to send is enforced at the stage change (A13: Manager must price every
// line before Approved). Export/send is therefore only allowed from Approved onward,
// which lets Team send an already-approved proposal without holding proposal.approve_send.
const EXPORTABLE_STAGES = ['Approved', 'Sent', 'Negotiating']
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * "Export & log share" — one action does what the PRD's 6.12 describes:
 *  A18 builds the brand-facing Excel, A19 files it in the proposal's Drive folder,
 *  A20 logs a share for every line, tied to the exact proposal version sent.
 *
 * Drive filing is best-effort: if it fails the user still gets the file and the share
 * is still logged (the brand did receive it); the failure is audited and reported in a header.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.create')
    const svc = supabaseService()

    const { data: proposal } = await svc
      .from('proposals')
      .select('id, stage, brand_id, route_id, currency, created_at, brands(name), contacts(name)')
      .eq('id', params.id).eq('org_id', profile.org_id).single()
    if (!proposal) throw new ApiError(404, 'Proposal not found')
    if (!EXPORTABLE_STAGES.includes(proposal.stage)) {
      throw new ApiError(400, `A proposal must be Approved before it can be exported (it is currently ${proposal.stage}).`)
    }
    const brandName = (proposal.brands as unknown as { name: string } | null)?.name ?? 'Brand'
    const contactName = (proposal.contacts as unknown as { name: string } | null)?.name ?? null

    const { data: lines } = await svc
      .from('proposal_lines')
      .select('id, item_id, quantity, sell_price, items(name, properties(name))')
      .eq('proposal_id', params.id)
      .order('created_at', { ascending: true })
    if (!lines || lines.length === 0) throw new ApiError(400, 'This proposal has no lines to export')

    // A line added after approval hasn't been priced by a Manager — don't let it out.
    const unpriced = await findUnpricedLines(params.id)
    if (unpriced.length > 0) {
      throw new ApiError(400, `Not priced at Manager level yet: ${unpriced.map((l) => l.name).join(', ')}. Price them before exporting.`)
    }

    // Unit label (brand-facing) + a currency sanity check, both from the cost source record.
    const { data: pricing } = await svc
      .from('proposal_line_pricing')
      .select('proposal_line_id, price_records(currency, unit)')
      .in('proposal_line_id', lines.map((l) => l.id))
    const sourceByLine = new Map((pricing ?? []).map((p) => [p.proposal_line_id, p.price_records as unknown as { currency: string; unit: string | null } | null]))

    const mismatched = lines.filter((l) => {
      const src = sourceByLine.get(l.id)
      return src && src.currency !== proposal.currency
    })
    if (mismatched.length > 0) {
      const names = mismatched.map((l) => (l.items as unknown as { name: string })?.name).join(', ')
      throw new ApiError(400, `Currency mismatch on: ${names}. No conversion is supported, so exporting would mislabel the price.`)
    }

    // A21–A25: warn before sending. Every line that conflicts with an earlier share needs an APPROVED override.
    // Checked before a version is minted or anything is written, so a blocked export leaves no trace.
    const overrideByItem = new Map<string, string>()
    const summaryByItem = new Map<string, string>()
    const blocked: { item: string; conflicts: Conflict[] }[] = []
    for (const l of lines) {
      const base = { orgId: profile.org_id, itemId: l.item_id, brandId: proposal.brand_id, routeId: proposal.route_id as string | null }
      const conflicts = await checkConflicts(base)
      if (conflicts.length === 0) continue
      const ov = await findUsableOverride(base)
      if (ov) { overrideByItem.set(l.item_id, ov.id); summaryByItem.set(l.item_id, summarizeConflicts(conflicts)) }
      else blocked.push({ item: (l.items as unknown as { name: string } | null)?.name ?? '', conflicts })
    }
    if (blocked.length > 0) {
      return NextResponse.json({
        error: `Sending would conflict with earlier shares on: ${blocked.map((b) => b.item).join(', ')}. Request an override (Manager/CEO approval, with a reason) first.`,
        conflicts: blocked
      }, { status: 409 })
    }

    const { version } = await getOrCreateVersion({ profile, proposalId: params.id, note: 'Export' })

    const data: ExportData = {
      brandName,
      contactName,
      currency: proposal.currency,
      versionNumber: version.version_number,
      preparedOn: new Date(),
      lines: lines.map((l) => {
        const item = l.items as unknown as { name: string; properties: { name: string } | null } | null
        return {
          property: item?.properties?.name ?? '',
          item: item?.name ?? '',
          basis: sourceByLine.get(l.id)?.unit ?? null,
          quantity: Number(l.quantity),
          unitPrice: Number(l.sell_price)
        }
      })
    }
    const buffer = await buildProposalWorkbook(data)
    const filename = `EmergeX-Proposal-${safeFilePart(brandName)}-v${version.version_number}.xlsx`

    // A20: log the share first — if this fails we abort before filing anything in Drive.
    const { error: shareError } = await svc.from('shares').insert(lines.map((l) => ({
      org_id: profile.org_id, item_id: l.item_id, brand_id: proposal.brand_id, route_id: proposal.route_id,
      channel: 'Proposal export', proposal_version_id: version.id, logged_by: profile.id, logged_after_the_fact: false,
      override_id: overrideByItem.get(l.item_id) ?? null, conflict_summary: summaryByItem.get(l.item_id) ?? null
    })))
    if (shareError) throw new ApiError(500, `Could not log the share: ${shareError.message}`)
    if (overrideByItem.size > 0) {
      await svc.from('share_conflict_overrides').update({ status: 'used', used_at: new Date().toISOString() }).in('id', Array.from(overrideByItem.values()))
    }

    // A19: file it in the proposal's Drive folder (best effort), chaining versions with one marked current.
    let drive: { status: 'filed' | 'failed'; detail: string } = { status: 'failed', detail: '' }
    try {
      const folderId = await ensureFolderId({
        orgId: profile.org_id, actorId: profile.id, entityType: 'proposal', entityId: params.id,
        folderName: proposalFolderName(brandName, proposal.created_at, params.id)
      })
      if (!folderId) throw new Error('Could not create or find the proposal folder (is Google Drive configured?)')
      const uploaded = await uploadFileToFolder({ folderId, name: filename, mimeType: XLSX_MIME, content: buffer })

      await svc.from('files').update({ is_current: false })
        .eq('org_id', profile.org_id).eq('linked_type', 'proposal').eq('linked_id', params.id).eq('kind', 'proposal_export')
      await svc.from('files').insert({
        org_id: profile.org_id, linked_type: 'proposal', linked_id: params.id, kind: 'proposal_export',
        drive_file_id: uploaded.fileId, drive_folder_id: folderId, name: filename, version: version.version_number,
        is_current: true, uploaded_by: profile.id, proposal_version_id: version.id
      })
      drive = { status: 'filed', detail: uploaded.webViewLink ?? '' }
    } catch (e) {
      drive = { status: 'failed', detail: e instanceof Error ? e.message : String(e) }
    }

    await writeAudit({
      orgId: profile.org_id, actorId: profile.id, action: 'export', entityType: 'proposal', entityId: params.id,
      after: { version_number: version.version_number, filename, shares_logged: lines.length, drive_status: drive.status, drive_detail: drive.detail }
    })

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': XLSX_MIME,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Export-Version': String(version.version_number),
        'X-Export-Shares': String(lines.length),
        'X-Export-Drive': drive.status,
        'X-Export-Drive-Detail': encodeURIComponent(drive.detail)
      }
    })
  } catch (err) {
    return errorResponse(err)
  }
}

// Vercel: this route calls other services / loops over rows, so give it more than the short default.
export const maxDuration = 60

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
