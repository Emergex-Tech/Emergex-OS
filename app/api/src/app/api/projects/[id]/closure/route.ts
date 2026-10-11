import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { supabaseService } from '@/lib/supabaseServer'
import { loadClosureFacts } from '@/lib/projectService'
import { closureIssues } from '@/lib/closure'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

/** What would still be open if this project were closed now. Read-only: the same list the close action records. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    if (!isUuid(params.id)) throw new ApiError(404, 'Project not found')
    const { data: p } = await supabaseService().from('projects').select('id, status, deal_id').eq('id', params.id).eq('org_id', profile.org_id).maybeSingle()
    if (!p) throw new ApiError(404, 'Project not found')
    const facts = await loadClosureFacts(profile.org_id, p.id, p.deal_id)
    return NextResponse.json({ status: p.status, issues: closureIssues(facts), facts })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
