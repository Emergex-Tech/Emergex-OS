import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { getOrCreateVersion } from '@/lib/proposalVersions'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

/** A15: list a proposal's versions with their change records. Brand-facing data only, so every internal role may read it. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const svc = supabaseService()
    const { data, error } = await svc
      .from('proposal_versions')
      .select('id, version_number, change_summary, note, created_at, snapshot')
      .eq('proposal_id', params.id)
      .eq('org_id', profile.org_id)
      .order('version_number', { ascending: false })
    if (error) throw new ApiError(400, error.message)
    return NextResponse.json((data ?? []).map((v) => ({
      id: v.id, version_number: v.version_number, change_summary: v.change_summary, note: v.note, created_at: v.created_at,
      total: (v.snapshot as { total?: number } | null)?.total ?? null,
      currency: (v.snapshot as { currency?: string } | null)?.currency ?? null
    })))
  } catch (err) {
    return errorResponse(err)
  }
}

/** Save a version on demand. If nothing changed since the latest version, no new one is created. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.create')
    const body = await req.json().catch(() => ({}))

    const svc = supabaseService()
    const { data: proposal } = await svc.from('proposals').select('id').eq('id', params.id).eq('org_id', profile.org_id).single()
    if (!proposal) throw new ApiError(404, 'Proposal not found')

    const { version, created } = await getOrCreateVersion({ profile, proposalId: params.id, note: body.note ?? null })
    return NextResponse.json({ version_number: version.version_number, change_summary: version.change_summary, created }, { status: created ? 201 : 200 })
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
