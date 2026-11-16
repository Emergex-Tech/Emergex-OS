import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadImportTarget } from '@/lib/tracker/service'
import { parseProofLink, PLATFORM_LABEL, type Platform } from '@/lib/proofLinks'
import { isValidIsoDate } from '@/lib/billing'
import { errorResponse } from '@/lib/apiError'

const MAX_ROWS = 200, MAX_LINKS = 8
/**
 * Step 2 of a status-list import. Each reviewed row names a deliverable and ONE action:
 *   complete — log what is still outstanding as delivered on `as_of` (so the deliverable reads delivered), with the row's links as proof;
 *   waive    — mark it waived by the brand, with the reason (Manager/CEO only);
 *   links    — only attach the links as proof.
 * All rows and permissions are checked before anything is written. Re-importing does nothing twice: a complete deliverable is not
 * logged again, an attached link is not attached again, a waived deliverable stays waived.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params   // Next 15+: route params arrive as a Promise
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    const target = await loadImportTarget(profile.org_id, params.id)
    const b = await req.json().catch(() => ({}))
    if (typeof b.as_of !== 'string' || !isValidIsoDate(b.as_of)) throw new ApiError(400, 'Give the date these were completed by (as_of, YYYY-MM-DD)')
    if (b.as_of > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)) throw new ApiError(400, 'as_of cannot be in the future')
    if (!Array.isArray(b.rows) || b.rows.length === 0) throw new ApiError(400, 'There is nothing to import')
    if (b.rows.length > MAX_ROWS) throw new ApiError(400, `At most ${MAX_ROWS} rows at a time`)
    type Row = { d: (typeof target.deliverables)[number]; action: 'complete' | 'waive' | 'links'; links: { url: string; platform: Platform }[]; reason: string }
    const rows: Row[] = [], rejected: { index: number; error: string }[] = []
    b.rows.forEach((r: Record<string, unknown>, index: number) => {
      try {
        if (!r || typeof r !== 'object') throw new Error('Not a valid row')
        const d = target.deliverables.find((x) => x.id === r.deliverable_id)
        if (!d) throw new Error('is not matched to one of this project\'s deliverables')
        if (!['complete', 'waive', 'links'].includes(r.action as string)) throw new Error("action must be 'complete', 'waive' or 'links'")
        if (d.status === 'replaced') throw new Error(`"${d.description}" was replaced by a make-good`)
        if (r.action === 'complete' && d.status === 'waived') throw new Error(`"${d.description}" is waived — reinstate it first`)
        const raw: unknown[] = r.links == null ? [] : Array.isArray(r.links) ? r.links : [null]
        if (raw.length > MAX_LINKS) throw new Error(`more than ${MAX_LINKS} links`)
        const links = raw.map((l) => { const p = parseProofLink(l); if (!p.ok) throw new Error(`a link is not acceptable: ${p.reason}`); return { url: p.url, platform: p.platform } })
        const reason = typeof r.reason === 'string' ? r.reason.trim() : ''
        if (r.action === 'waive' && (!reason || reason.length > 500)) throw new Error('waiving needs a reason of 1–500 characters')
        if (r.action === 'links' && links.length === 0) throw new Error('has no link to attach')
        rows.push({ d, action: r.action as Row['action'], links, reason })
      } catch (err) { rejected.push({ index, error: err instanceof Error ? err.message : String(err) }) }
    })
    if (rejected.length) return NextResponse.json({ error: `${rejected.length} ${rejected.length === 1 ? 'row is' : 'rows are'} not valid, so nothing was imported`, rejected }, { status: 400 })
    if (new Set(rows.map((r) => r.d.id)).size !== rows.length) throw new ApiError(400, 'Two rows point at the same deliverable — choose one')
    if (rows.some((r) => r.action === 'waive')) await requirePermission(profile, 'project.manage')      // checked BEFORE anything is written

    const svc = supabaseService(), ids = rows.map((r) => r.d.id)
    const { data: haveLinks } = await svc.from('deliverable_proofs').select('deliverable_id, url').in('deliverable_id', ids).eq('kind', 'link').is('archived_at', null).limit(20000)
    const attached = new Set((haveLinks ?? []).map((x) => `${x.deliverable_id}|${x.url}`))
    const { data: evs } = await svc.from('deliverable_events').select('deliverable_id, quantity').in('deliverable_id', ids).is('voided_at', null).limit(20000)
    const loggedSum = new Map<string, number>(); for (const e of evs ?? []) loggedSum.set(e.deliverable_id, (loggedSum.get(e.deliverable_id) ?? 0) + Number(e.quantity))
    const out = { completed: 0, already_complete: 0, waived: 0, already_waived: 0, links: 0 }
    for (const r of rows) {
      const fresh = r.links.filter((l) => !attached.has(`${r.d.id}|${l.url}`))
      let eventId: string | null = null
      if (r.action === 'waive') {
        if (r.d.status === 'waived') out.already_waived++
        else { const { error } = await svc.from('deliverables').update({ status: 'waived', waived_reason: r.reason, invoice_adjustment: false, adjustment_note: null, updated_at: new Date().toISOString() }).eq('id', r.d.id); if (error) throw new ApiError(400, `${r.d.description}: ${error.message}`); out.waived++ }
      } else if (r.action === 'complete') {
        // the log must END UP equal to the planned quantity, whatever number was typed before: log the difference from what is already LOGGED
        const outstanding = Math.round((r.d.planned_quantity - (loggedSum.get(r.d.id) ?? 0)) * 100) / 100
        if (outstanding <= 0) out.already_complete++
        else {
          eventId = crypto.randomUUID()
          const { error } = await svc.from('deliverable_events').insert({ id: eventId, org_id: profile.org_id, deliverable_id: r.d.id, occurred_on: b.as_of, quantity: outstanding, label: 'Marked completed in the tracker', source: 'tracker_import', created_by: profile.id })
          if (error) throw new ApiError(400, `${r.d.description}: ${error.message}`)
          out.completed++
        }
      }
      if (fresh.length) {
        const { error } = await svc.from('deliverable_proofs').insert(fresh.map((l) => ({ org_id: profile.org_id, deliverable_id: r.d.id, event_id: eventId, kind: 'link', name: `${PLATFORM_LABEL[l.platform]} — ${r.d.description}`.slice(0, 200), url: l.url, platform: l.platform, report_visible: b.show_links_to_brand === true, added_by: profile.id })))
        if (error) throw new ApiError(400, `${r.d.description}: ${error.message}`)
        fresh.forEach((l) => attached.add(`${r.d.id}|${l.url}`)); out.links += fresh.length
      }
    }
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'tracker_status_list_imported', entityType: 'project', entityId: target.project.id, after: out })
    return NextResponse.json(out, { status: out.completed + out.waived + out.links > 0 ? 201 : 200 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
