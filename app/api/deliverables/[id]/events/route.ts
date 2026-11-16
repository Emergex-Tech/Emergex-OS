import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { parseProofLink, PLATFORM_LABEL } from '@/lib/proofLinks'
import { isValidIsoDate } from '@/lib/billing'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

const MAX_LINKS = 8
async function loadDeliverable(orgId: string, id: string) {
  if (!isUuid(id)) throw new ApiError(404, 'Deliverable not found')
  const { data } = await supabaseService().from('deliverables').select('id, description, status, planned_quantity, delivered_quantity, unit').eq('id', id).eq('org_id', orgId).maybeSingle()
  if (!data) throw new ApiError(404, 'Deliverable not found')
  return data
}

/** The delivery log of one deliverable, newest first, each entry with the proof attached to it. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params   // Next 15+: route params arrive as a Promise
  try {
    const profile = await requireProfile()
    const d = await loadDeliverable(profile.org_id, params.id)
    const svc = supabaseService()
    let q = svc.from('deliverable_events').select('id, occurred_on, quantity, label, note, source, created_at, voided_at, void_reason, creator:profiles!deliverable_events_created_by_fkey(full_name)').eq('deliverable_id', d.id).order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(1000)
    if (req.nextUrl.searchParams.get('include_voided') !== '1') q = q.is('voided_at', null)
    const { data, error } = await q
    if (error) throw new ApiError(500, error.message)
    const { data: proofs } = await svc.from('deliverable_proofs').select('id, event_id, name, url, platform, report_visible').eq('deliverable_id', d.id).is('archived_at', null).not('event_id', 'is', null)
    return NextResponse.json({
      deliverable: { id: d.id, description: d.description, status: d.status, planned_quantity: Number(d.planned_quantity), delivered_quantity: Number(d.delivered_quantity), unit: d.unit },
      events: (data ?? []).map((e) => ({ id: e.id, occurred_on: e.occurred_on, quantity: Number(e.quantity), label: e.label, note: e.note, source: e.source, voided_at: e.voided_at, void_reason: e.void_reason, created_by_name: (e.creator as unknown as { full_name: string } | null)?.full_name ?? null, links: (proofs ?? []).filter((p) => p.event_id === e.id).map((p) => ({ id: p.id, name: p.name, url: p.url, platform: p.platform, report_visible: p.report_visible })) }))
    })
  } catch (err) { return errorResponse(err) }
}

/**
 * Log one delivery: a post, a match, a day. {occurred_on, quantity (default 1), label?, note?, links?: string[], show_links_to_brand?}.
 * The delivered quantity and status are then recalculated BY THE DATABASE from the log. Links are validated first — if any is not
 * acceptable, nothing is saved. Links are hidden from the brand unless show_links_to_brand is true.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params   // Next 15+: route params arrive as a Promise
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.update')
    const d = await loadDeliverable(profile.org_id, params.id)
    if (d.status === 'replaced') throw new ApiError(400, 'This deliverable has been replaced by a make-good; log the delivery against the make-good instead')
    if (d.status === 'waived') throw new ApiError(400, 'This deliverable was waived by the brand; reinstate it before logging a delivery')
    const b = await req.json().catch(() => ({}))
    if (typeof b.occurred_on !== 'string' || !isValidIsoDate(b.occurred_on)) throw new ApiError(400, 'occurred_on must be a valid date (YYYY-MM-DD)')
    if (b.occurred_on > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)) throw new ApiError(400, 'A delivery cannot be logged for a future date')
    const qty = b.quantity == null ? 1 : Number(b.quantity)
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1e9) throw new ApiError(400, 'quantity must be a number greater than zero')
    const label = typeof b.label === 'string' ? b.label.trim() : ''
    if (label.length > 200) throw new ApiError(400, 'label can be at most 200 characters')
    if (b.note != null && (typeof b.note !== 'string' || b.note.length > 500)) throw new ApiError(400, 'note can be at most 500 characters')
    const rawLinks: unknown[] = b.links == null ? [] : Array.isArray(b.links) ? b.links : [null]
    if (rawLinks.length > MAX_LINKS) throw new ApiError(400, `At most ${MAX_LINKS} links per entry`)
    const links = rawLinks.map((l) => parseProofLink(l))
    const bad = links.find((l) => !l.ok)
    if (bad && !bad.ok) throw new ApiError(400, `A link is not acceptable: ${bad.reason}`)
    const good = links.flatMap((l) => (l.ok ? [l] : []))
    if (new Set(good.map((l) => l.url)).size !== good.length) throw new ApiError(400, 'The same link is listed twice')

    const svc = supabaseService()
    if (good.length) {
      const { data: dup } = await svc.from('deliverable_proofs').select('url').eq('deliverable_id', d.id).eq('kind', 'link').is('archived_at', null).in('url', good.map((l) => l.url))
      if (dup?.length) throw new ApiError(409, `Already attached to this deliverable: ${dup.map((x) => x.url).join(', ')}`)
    }
    const { data: ev, error } = await svc.from('deliverable_events').insert({ org_id: profile.org_id, deliverable_id: d.id, occurred_on: b.occurred_on, quantity: Math.round(qty * 100) / 100, label: label || null, note: typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null, created_by: profile.id }).select('id').single()
    if (error) throw new ApiError(400, error.message)
    if (good.length) {
      const { error: pe } = await svc.from('deliverable_proofs').insert(good.map((l) => ({ org_id: profile.org_id, deliverable_id: d.id, event_id: ev.id, kind: 'link', name: `${PLATFORM_LABEL[l.platform]}${label ? ` — ${label}` : ''}`.slice(0, 200), url: l.url, platform: l.platform, report_visible: b.show_links_to_brand === true, added_by: profile.id })))
      if (pe) { // the entry must not exist without the links it was logged with: void it and say so
        await svc.from('deliverable_events').update({ voided_at: new Date().toISOString(), voided_by: profile.id, void_reason: 'Automatic: its links could not be saved' }).eq('id', ev.id)
        throw new ApiError(400, `The links could not be saved, so the entry was not logged: ${pe.message}`)
      }
    }
    const { data: after } = await svc.from('deliverables').select('status, delivered_quantity, planned_quantity').eq('id', d.id).single()
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'delivery_logged', entityType: 'deliverable', entityId: d.id, after: { event_id: ev.id, quantity: qty, links: good.length } })
    return NextResponse.json({ id: ev.id, links: good.length, deliverable: { status: after!.status, delivered_quantity: Number(after!.delivered_quantity), planned_quantity: Number(after!.planned_quantity) } }, { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
