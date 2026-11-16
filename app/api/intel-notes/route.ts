import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { createRecord } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    if (!body.note) throw new ApiError(400, 'note is required')

    const note = await createRecord({
      profile,
      permission: 'record.create',
      table: 'intel_notes',
      entityType: 'intel_note',
      data: {
        linked_type: body.linked_type ?? null,
        linked_id: body.linked_id ?? null,
        source: profile.role_key, // 'team' | 'management' (legacy) | 'manager' | 'ceo'; Stage 2B will pass 'agent' + submitted_by_agent_id
        reliability: body.reliability ?? 'likely',
        note_type: body.note_type ?? null,
        confidentiality: body.confidentiality ?? 'internal',
        note: body.note
      }
    })

    // "Price intel also creates a market-intel price record" (PRD 6.8)
    if (body.price_amount && body.item_id) {
      const svc = supabaseService()
      await svc.from('price_records').insert({
        org_id: profile.org_id,
        item_id: body.item_id,
        type: 'market_intel',
        amount: body.price_amount,
        currency: body.currency ?? 'USD',
        source: 'intel:' + note.id,
        recorded_by: profile.id
      })
    }

    return NextResponse.json(note, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
