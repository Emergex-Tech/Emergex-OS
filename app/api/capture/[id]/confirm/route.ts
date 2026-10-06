import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { createRecord } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

const TABLE_BY_ENTITY: Record<string, string> = {
  vendor: 'vendors',
  property: 'properties',
  item: 'items',
  price_record: 'price_records',
  intel_note: 'intel_notes',
  share: 'shares'
}
const PERMISSION_BY_ENTITY: Record<string, string> = {
  vendor: 'record.create',
  property: 'record.create',
  item: 'record.create',
  price_record: 'price.record_cost',
  intel_note: 'record.create',
  share: 'record.create'
}

/**
 * This is the ONLY place a capture's AI-proposed records become real rows.
 * The person reviews/edits `records` client-side first (see /capture page) —
 * this endpoint does not re-run or trust the AI's original draft, only what
 * was submitted here, which may differ from ai_output if the user edited it.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    const records = body.records as Array<{ entity_type: string; action: string; fields: Record<string, unknown> }>
    if (!Array.isArray(records)) throw new ApiError(400, 'records array is required')

    const svc = supabaseService()
    const { data: capture } = await svc.from('captures').select('*').eq('id', params.id).single()
    if (!capture) throw new ApiError(404, 'Capture not found')
    if (capture.status !== 'pending_review') throw new ApiError(400, 'Capture already reviewed')

    const createdRefs: { entity_type: string; entity_id: string }[] = []

    for (const rec of records) {
      if (rec.action === 'confirm') {
        // Re-uses the same confirmation semantics as /api/confirmations,
        // but inline since we already have the profile/svc in scope.
        await svc.from('confirmations').insert({
          org_id: profile.org_id,
          entity_type: rec.fields.entity_type,
          entity_id: rec.fields.entity_id,
          confirmed_by: profile.id
        })
        createdRefs.push({ entity_type: String(rec.fields.entity_type), entity_id: String(rec.fields.entity_id) })
        continue
      }

      const table = TABLE_BY_ENTITY[rec.entity_type]
      const permission = PERMISSION_BY_ENTITY[rec.entity_type]
      if (!table || !permission) throw new ApiError(400, `Unknown entity_type: ${rec.entity_type}`)

      const created = await createRecord({
        profile,
        permission,
        table,
        entityType: rec.entity_type,
        data: rec.fields,
        duplicateCheck: rec.entity_type === 'property' ? { entityType: 'property', nameField: 'name' }
          : rec.entity_type === 'vendor' ? { entityType: 'vendor', nameField: 'name' }
          : undefined
      })
      createdRefs.push({ entity_type: rec.entity_type, entity_id: created.id })
    }

    // Originals are always kept and linked (PRD 6.2) — raw_input + ai_output
    // stay on the captures row permanently; we just mark it reviewed.
    await svc.from('captures').update({
      status: 'confirmed',
      reviewed_by: profile.id,
      created_record_refs: createdRefs
    }).eq('id', params.id)

    return NextResponse.json({ ok: true, created: createdRefs })
  } catch (err) {
    return errorResponse(err)
  }
}

// Vercel: this route calls other services / loops over rows, so give it more than the short default.
export const maxDuration = 60

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
