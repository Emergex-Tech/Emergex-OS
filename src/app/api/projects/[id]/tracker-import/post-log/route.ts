import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadImportTarget } from '@/lib/tracker/service'
import { parseProofLink, PLATFORM_LABEL, type Platform } from '@/lib/proofLinks'
import { isValidIsoDate } from '@/lib/billing'
import { errorResponse } from '@/lib/apiError'

const MAX_ENTRIES = 400, MAX_LINKS = 8
/**
 * Step 2 of a post-log import: save what a person reviewed, as delivery-log entries on ONE deliverable, each with its links.
 * EVERY entry is validated first — if any is invalid NOTHING is saved and the bad ones are listed. Links already attached to this
 * deliverable are not attached twice, and an entry whose links are all already there is skipped as a duplicate, so re-importing
 * an updated tracker only adds what is new. Entries are marked source=tracker_import and, like every log entry, can only be voided.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params   // Next 15+: route params arrive as a Promise
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    const target = await loadImportTarget(profile.org_id, params.id)
    const b = await req.json().catch(() => ({}))
    const d = target.deliverables.find((x) => x.id === b.deliverable_id)
    if (!d) throw new ApiError(400, 'Choose which of this project\'s deliverables these posts count towards')
    if (d.status === 'replaced' || d.status === 'waived') throw new ApiError(400, `That deliverable is ${d.status}, so nothing can be logged on it`)
    if (!Array.isArray(b.entries) || b.entries.length === 0) throw new ApiError(400, 'There is nothing to import')
    if (b.entries.length > MAX_ENTRIES) throw new ApiError(400, `At most ${MAX_ENTRIES} entries at a time`)
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

    type Row = { occurred_on: string; quantity: number; label: string | null; links: { url: string; platform: Platform }[] }
    const rows: Row[] = [], rejected: { index: number; error: string }[] = []
    b.entries.forEach((e: Record<string, unknown>, index: number) => {
      try {
        if (!e || typeof e !== 'object') throw new Error('Not a valid entry')
        if (typeof e.occurred_on !== 'string' || !isValidIsoDate(e.occurred_on)) throw new Error('needs a valid date (YYYY-MM-DD)')
        if (e.occurred_on > tomorrow) throw new Error('the date is in the future')
        const qty = e.quantity == null ? 1 : Number(e.quantity)
        if (!Number.isFinite(qty) || qty <= 0 || qty > 1e9) throw new Error('the quantity must be greater than zero')
        const label = typeof e.label === 'string' ? e.label.trim() : ''
        if (label.length > 200) throw new Error('the label is longer than 200 characters')
        const raw: unknown[] = e.links == null ? [] : Array.isArray(e.links) ? e.links : [null]
        if (raw.length > MAX_LINKS) throw new Error(`more than ${MAX_LINKS} links`)
        const links = raw.map((l) => { const p = parseProofLink(l); if (!p.ok) throw new Error(`a link is not acceptable: ${p.reason}`); return { url: p.url, platform: p.platform } })
        rows.push({ occurred_on: e.occurred_on, quantity: Math.round(qty * 100) / 100, label: label || null, links })
      } catch (err) { rejected.push({ index, error: err instanceof Error ? err.message : String(err) }) }
    })
    if (rejected.length) return NextResponse.json({ error: `${rejected.length} ${rejected.length === 1 ? 'entry is' : 'entries are'} not valid, so nothing was imported`, rejected }, { status: 400 })

    const svc = supabaseService()
    const { data: have } = await svc.from('deliverable_proofs').select('url').eq('deliverable_id', d.id).eq('kind', 'link').is('archived_at', null).limit(20000)
    const attached = new Set((have ?? []).map((x) => x.url as string))
    const { data: logged } = await svc.from('deliverable_events').select('occurred_on, quantity, label').eq('deliverable_id', d.id).is('voided_at', null).limit(20000)
    const sig = (r: { occurred_on: string; quantity: number; label: string | null }) => `${r.occurred_on}|${Number(r.quantity)}|${(r.label ?? '').toLowerCase()}`
    const loggedSigs = new Set((logged ?? []).map((x) => sig({ occurred_on: x.occurred_on, quantity: Number(x.quantity), label: x.label })))

    const events: Record<string, unknown>[] = [], proofs: Record<string, unknown>[] = []; let skipped = 0
    for (const r of rows) {
      const fresh = r.links.filter((l) => !attached.has(l.url))
      if (r.links.length ? fresh.length === 0 : loggedSigs.has(sig(r))) { skipped++; continue }      // every link already attached, or the same link-less entry already logged
      const id = crypto.randomUUID()
      events.push({ id, org_id: profile.org_id, deliverable_id: d.id, occurred_on: r.occurred_on, quantity: r.quantity, label: r.label, source: 'tracker_import', created_by: profile.id })
      for (const l of fresh) { attached.add(l.url); proofs.push({ org_id: profile.org_id, deliverable_id: d.id, event_id: id, kind: 'link', name: `${PLATFORM_LABEL[l.platform]}${r.label ? ` — ${r.label}` : ''}`.slice(0, 200), url: l.url, platform: l.platform, report_visible: b.show_links_to_brand === true, added_by: profile.id }) }
      loggedSigs.add(sig(r))
    }
    if (events.length) {
      const { error } = await svc.from('deliverable_events').insert(events)
      if (error) throw new ApiError(400, error.message)
      if (proofs.length) {
        const { error: pe } = await svc.from('deliverable_proofs').insert(proofs)
        if (pe) { // entries must not stand without the links they came with
          await svc.from('deliverable_events').update({ voided_at: new Date().toISOString(), voided_by: profile.id, void_reason: 'Automatic: the import could not save its links' }).in('id', events.map((e) => e.id as string))
          throw new ApiError(400, `The links could not be saved, so the import was undone: ${pe.message}`)
        }
      }
    }
    const { data: after } = await svc.from('deliverables').select('status, delivered_quantity, planned_quantity').eq('id', d.id).single()
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'tracker_post_log_imported', entityType: 'deliverable', entityId: d.id, after: { project_id: target.project.id, imported: events.length, links: proofs.length, skipped_duplicates: skipped } })
    return NextResponse.json({ imported: events.length, links: proofs.length, skipped_duplicates: skipped, deliverable: { status: after!.status, delivered_quantity: Number(after!.delivered_quantity), planned_quantity: Number(after!.planned_quantity) } }, { status: events.length ? 201 : 200 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
