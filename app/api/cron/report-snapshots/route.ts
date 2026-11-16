import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '@/lib/supabaseServer'
import { takeSnapshot, utcToday } from '@/lib/reportService'
import { isSnapshotDue, type Cadence } from '@/lib/reportCadence'

/**
 * L17: run once a day (see vercel.json). Takes every snapshot that is due. Authorised ONLY by the CRON_SECRET bearer token
 * (Vercel sends it); with no secret set, or a wrong one, it does nothing. Safe to run twice: one automatic snapshot per project per day.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? ''
  const given = Buffer.from(req.headers.get('authorization') ?? ''), want = Buffer.from(`Bearer ${secret}`)
  if (secret.length < 16 || given.length !== want.length || !crypto.timingSafeEqual(given, want)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const svc = supabaseService(), today = utcToday()
  const { data: rows } = await svc.from('project_report_settings').select('project_id, org_id, cadence').neq('cadence', 'manual')
  let taken = 0, blocked = 0, already = 0, notDue = 0, errors = 0
  for (const r of rows ?? []) {
    try {
      const { data: project } = await svc.from('projects').select('id, name, deal_id, status').eq('id', r.project_id).eq('org_id', r.org_id).eq('status', 'active').maybeSingle()
      if (!project) continue
      const { data: last } = await svc.from('report_snapshots').select('period_date').eq('project_id', r.project_id).eq('trigger', 'cadence').order('period_date', { ascending: false }).limit(1)
      if (!isSnapshotDue(r.cadence as Cadence, last?.[0]?.period_date ?? null, today)) { notDue++; continue }
      const s = await takeSnapshot(r.org_id, project, { trigger: 'cadence', takenBy: null })
      if (!s.created) already++; else { taken++; if (s.leaks.length) blocked++ }
    } catch { errors++ }
  }
  return NextResponse.json({ date: today, taken, blocked, already_taken: already, not_due: notDue, errors })
}
export const dynamic = 'force-dynamic'
