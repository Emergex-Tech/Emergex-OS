import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadOwnProject } from '@/lib/projectService'
import { validateCommFields } from '@/lib/commLog'
import { waitingOn } from '@/lib/projects'
import { dedupeKey } from '@/lib/chatParse'
import { isUuid } from '@/lib/ids'
import { errorResponse } from '@/lib/apiError'

const MAX_ENTRIES = 200

/**
 * L30, step 2 of 2: save what a person reviewed. Every entry is validated by the SAME rules as the manual log. If ANY entry is
 * invalid NOTHING is saved (and the bad ones are listed), so an import is never half-done. Exact duplicates — of the log, or within
 * the batch — are skipped. Entries are marked source=chat_import and, like all log entries, can never be edited afterwards.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.create')
    const project = await loadOwnProject(profile.org_id, params.id)
    const b = await req.json().catch(() => ({}))
    if (!Array.isArray(b.entries) || b.entries.length === 0) throw new ApiError(400, 'Choose at least one message to import')
    if (b.entries.length > MAX_ENTRIES) throw new ApiError(400, `At most ${MAX_ENTRIES} messages at a time`)
    const svc = supabaseService()

    const partyIds = Array.from(new Set(b.entries.map((e: { party_id?: unknown }) => e?.party_id).filter((x: unknown) => x != null))) as string[]
    if (partyIds.some((p) => !isUuid(p))) throw new ApiError(400, 'A party id is not valid')
    const { data: okParties } = partyIds.length ? await svc.from('project_parties').select('id').eq('project_id', project.id).is('archived_at', null).in('id', partyIds) : { data: [] as { id: string }[] }
    const goodParty = new Set((okParties ?? []).map((p) => p.id))

    const rejected: { index: number; error: string }[] = []
    const rows: { f: ReturnType<typeof validateCommFields>; party: string | null }[] = []
    b.entries.forEach((e: Record<string, unknown>, index: number) => {
      try {
        if (!e || typeof e !== 'object') throw new ApiError(400, 'Not a valid entry')
        const f = validateCommFields(e)
        if (e.party_id != null && !goodParty.has(e.party_id as string)) throw new ApiError(400, 'That party is not on this project')
        rows.push({ f, party: (e.party_id as string | undefined) ?? null })
      } catch (err) { rejected.push({ index, error: err instanceof Error ? err.message : String(err) }) }
    })
    if (rejected.length) return NextResponse.json({ error: `${rejected.length} message${rejected.length === 1 ? ' is' : 's are'} not valid, so nothing was imported`, rejected }, { status: 400 })

    const times = rows.map((r) => r.f.occurredAt).sort()
    const { data: existing } = await svc.from('project_communications').select('occurred_at, direction, summary').eq('project_id', project.id).gte('occurred_at', times[0]).lte('occurred_at', times[times.length - 1]).limit(5000)
    const seen = new Set((existing ?? []).map((e) => dedupeKey(e.occurred_at, e.direction, e.summary)))
    const toInsert: Record<string, unknown>[] = []; let skipped = 0
    for (const { f, party } of rows) {
      const key = dedupeKey(f.occurredAt, f.direction, f.summary)
      if (seen.has(key)) { skipped++; continue }
      seen.add(key)
      const isRequest = f.kind === 'request'
      toInsert.push({ org_id: profile.org_id, project_id: project.id, party_id: party, direction: f.direction, channel: f.channel, kind: f.kind, occurred_at: f.occurredAt, summary: f.summary,
        status: isRequest ? 'open' : 'done', waiting_on: isRequest ? waitingOn(f.direction) : null, created_by: profile.id, source: 'chat_import' })
    }
    if (toInsert.length) { const { error } = await svc.from('project_communications').insert(toInsert); if (error) throw new ApiError(400, error.message) }
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'project_chat_imported', entityType: 'project', entityId: project.id, after: { imported: toInsert.length, skipped_duplicates: skipped } })
    return NextResponse.json({ imported: toInsert.length, skipped_duplicates: skipped }, { status: toInsert.length ? 201 : 200 })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
