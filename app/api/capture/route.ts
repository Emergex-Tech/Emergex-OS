import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { parseCapture } from '@/lib/ai'
import { errorResponse } from '@/lib/apiError'

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    if (!body.raw_input) throw new ApiError(400, 'raw_input is required')

    await requirePermission(profile, 'record.create')
    const svc = supabaseService()

    const { data: categories } = await svc.from('categories').select('key, label')
    const draft = await parseCapture({ rawInput: body.raw_input, categories: categories ?? [] })

    // The capture row itself IS saved (it's just the raw input + AI's
    // proposal) — what's withheld is turning that proposal into real
    // vendor/property/item/etc. rows, which only /confirm does.
    const { data: capture, error } = await svc.from('captures').insert({
      org_id: profile.org_id,
      raw_input: body.raw_input,
      ai_output: draft,
      status: 'pending_review',
      ai_model: MODEL,
      submitted_by: profile.id
    }).select().single()

    if (error) throw new ApiError(400, error.message)

    return NextResponse.json(capture, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

// Vercel: this route calls other services / loops over rows, so give it more than the short default.
export const maxDuration = 60

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
