import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { supabaseService } from '@/lib/supabaseServer'
import { STUDY_COLUMNS } from '@/lib/caseStudyService'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    if (!isUuid(params.id)) throw new ApiError(404, 'Not found')
    const { data } = await supabaseService().from('case_studies').select(STUDY_COLUMNS).eq('id', params.id).eq('org_id', profile.org_id).maybeSingle()
    if (!data) throw new ApiError(404, 'Not found')
    return NextResponse.json(data)
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
