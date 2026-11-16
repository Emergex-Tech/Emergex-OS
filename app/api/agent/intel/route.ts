import { NextRequest, NextResponse } from 'next/server'
import { requireAgent, logAgentActivity } from '@/lib/agentAccess'
import { supabaseService } from '@/lib/supabaseServer'
import { toAgentIntelView, type IntelRow } from '@/lib/agentView'
import { isUuid } from '@/lib/ids'
import { ApiError } from '@/lib/auth'
import { errorResponse } from '@/lib/apiError'

const MAX_NOTE = 2000
const MAX_PENDING = 50 // a cap, so one account can't flood the review queue

/** Only this agent COMPANY's own notes. Nobody else's, and never internal notes (which have no agent id). */
export async function GET() {
  try {
    const ctx = await requireAgent()
    const { data, error } = await supabaseService().from('intel_notes').select('id, note, created_at, review_status, claimed_price, claimed_currency')
      .eq('org_id', ctx.profile.org_id).eq('submitted_by_agent_id', ctx.agentId).order('created_at', { ascending: false }).limit(200)
    if (error) throw new ApiError(500, 'Could not load your notes')
    await logAgentActivity(ctx, 'view_intel')
    return NextResponse.json((data ?? []).map((r) => toAgentIntelView(r as unknown as IntelRow)))
  } catch (err) { return errorResponse(err) }
}

/** B16: lands UNRATED (reliability null) and PENDING. A claimed price creates NO price record until a reviewer accepts it. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAgent()
    const body = await req.json().catch(() => ({}))
    const note = typeof body.note === 'string' ? body.note.trim() : ''
    if (!note) throw new ApiError(400, 'Write the note first')
    if (note.length > MAX_NOTE) throw new ApiError(400, `Notes can be at most ${MAX_NOTE} characters`)

    let price: number | null = null
    if (body.price != null && body.price !== '') {
      price = Number(body.price)
      if (!Number.isFinite(price) || price < 0 || price > 1e9) throw new ApiError(400, 'price must be a number between 0 and 1,000,000,000')
    }
    const currency = price == null ? null : String(body.currency ?? 'USD').toUpperCase()
    if (currency && !/^[A-Z]{3}$/.test(currency)) throw new ApiError(400, 'currency must be a 3-letter code')

    const svc = supabaseService()
    let itemId: string | null = null
    if (body.grant_id != null) {
      if (!isUuid(body.grant_id)) throw new ApiError(400, 'That item is not shared with you')
      const { data: g } = await svc.from('shareable_grants').select('item_id').eq('id', body.grant_id).eq('org_id', ctx.profile.org_id).eq('agent_id', ctx.agentId).is('revoked_at', null).maybeSingle()
      if (!g) throw new ApiError(400, 'That item is not shared with you')
      itemId = g.item_id
    }
    if (price != null && !itemId) throw new ApiError(400, 'A price can only be attached to one of your shared items')

    const pending = await svc.from('intel_notes').select('id', { count: 'exact', head: true }).eq('submitted_by_agent_id', ctx.agentId).eq('review_status', 'pending')
    if ((pending.count ?? 0) >= MAX_PENDING) throw new ApiError(429, `You already have ${MAX_PENDING} notes waiting for review. Please wait until some are reviewed.`)

    const { data, error } = await svc.from('intel_notes').insert({
      org_id: ctx.profile.org_id, linked_type: itemId ? 'item' : null, linked_id: itemId, source: 'agent',
      submitted_by: ctx.profile.id, submitted_by_agent_id: ctx.agentId, reliability: null, confidentiality: 'internal',
      note, review_status: 'pending', claimed_price: price, claimed_currency: currency
    }).select('id, note, created_at, review_status, claimed_price, claimed_currency').single()
    if (error) throw new ApiError(500, 'Could not save your note')
    await logAgentActivity(ctx, 'submit_intel', itemId)
    return NextResponse.json(toAgentIntelView(data as unknown as IntelRow), { status: 201 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
