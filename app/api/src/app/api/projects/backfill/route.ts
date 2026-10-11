import { NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { ensureProject } from '@/lib/projectService'
import { errorResponse } from '@/lib/apiError'

async function missingDeals(orgId: string) {
  const svc = supabaseService()
  const [deals, projects] = await Promise.all([svc.from('deals').select('id').eq('org_id', orgId), svc.from('projects').select('deal_id').eq('org_id', orgId)])
  const have = new Set((projects.data ?? []).map((p) => p.deal_id))
  return (deals.data ?? []).map((d) => d.id as string).filter((id) => !have.has(id))
}

/** How many won deals have no project yet (those won before Stage 3 was switched on, or whose automatic creation failed). */
export async function GET() {
  try {
    const profile = await requireProfile()
    return NextResponse.json({ missing: (await missingDeals(profile.org_id)).length })
  } catch (err) { return errorResponse(err) }
}

/** Creates the missing ones. Idempotent: running it twice creates nothing new. Does at most 100 per call. */
export async function POST() {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'project.manage')
    const missing = (await missingDeals(profile.org_id)).slice(0, 100)
    let created = 0; const failed: { deal_id: string; error: string }[] = []
    for (const id of missing) {
      try { if ((await ensureProject(profile.org_id, id, profile.id)).created) created++ } catch (e) { failed.push({ deal_id: id, error: e instanceof Error ? e.message : String(e) }) }
    }
    return NextResponse.json({ created, failed, remaining: Math.max(0, (await missingDeals(profile.org_id)).length) })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
