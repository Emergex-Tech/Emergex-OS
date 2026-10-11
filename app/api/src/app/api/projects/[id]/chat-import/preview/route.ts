import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { loadOwnProject } from '@/lib/projectService'
import { parseChat, suggestKind, formatSummary } from '@/lib/chatParse'
import { errorResponse } from '@/lib/apiError'

/**
 * L30, step 1 of 2. Reads a pasted WhatsApp/Telegram export and SHOWS what it found — it saves NOTHING. A person maps each sender
 * to a party and a side, adjusts what each message is, and only then confirms. Messages already in the log are flagged as duplicates.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'record.create')
    const project = await loadOwnProject(profile.org_id, params.id)
    const b = await req.json().catch(() => ({}))
    const order = b.date_order ?? 'dmy'
    if (!['dmy', 'mdy'].includes(order)) throw new ApiError(400, "date_order must be 'dmy' or 'mdy'")
    const offset = b.utc_offset_minutes == null ? 0 : Number(b.utc_offset_minutes)
    if (!Number.isInteger(offset) || offset < -840 || offset > 840) throw new ApiError(400, 'utc_offset_minutes must be a whole number of minutes between -840 and 840')
    const parsed = parseChat(typeof b.text === 'string' ? b.text : '', { dateOrder: order, utcOffsetMinutes: offset })
    if (parsed.error) throw new ApiError(400, parsed.error)

    const svc = supabaseService()
    const times = parsed.messages.map((m) => m.occurred_at).sort()
    const { data: existing } = times.length
      ? await svc.from('project_communications').select('occurred_at, summary').eq('project_id', project.id).gte('occurred_at', times[0]).lte('occurred_at', times[times.length - 1]).limit(5000)
      : { data: [] as { occurred_at: string; summary: string }[] }
    const seen = (existing ?? []).map((e) => ({ at: new Date(e.occurred_at).toISOString(), summary: e.summary }))
    const { data: parties } = await svc.from('project_parties').select('id, name, role, side').eq('project_id', project.id).is('archived_at', null).order('created_at')

    const senders = new Map<string, number>(); for (const m of parsed.messages) senders.set(m.sender, (senders.get(m.sender) ?? 0) + 1)
    return NextResponse.json({
      format: parsed.format, count: parsed.messages.length, skipped_system: parsed.skippedSystem, invalid_dates: parsed.invalidDates, truncated: parsed.truncated, date_order: order,
      senders: Array.from(senders.entries()).map(([name, n]) => ({ name, messages: n })), parties: parties ?? [],
      messages: parsed.messages.map((m) => ({
        index: m.index, occurred_at: m.occurred_at, sender: m.sender, text: m.text, suggested_kind: suggestKind(m.text), too_long: formatSummary(m.sender, m.text, false).truncated,
        duplicate: seen.some((s) => s.at === m.occurred_at && s.summary.includes(m.text.trim().slice(0, 100)))
      }))
    })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
