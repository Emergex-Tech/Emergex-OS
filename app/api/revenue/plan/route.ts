import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { isMonth } from '@/lib/revenue'
import { errorResponse } from '@/lib/apiError'

/**
 * Set (or clear) the plan for one month and currency. CEO only. {period:'YYYY-MM', currency, booked_target, collected_target?, note?}.
 * booked_target: null clears the month.
 */
export async function PUT(req: NextRequest) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'revenue.plan')
    const b = await req.json().catch(() => ({}))
    if (!isMonth(b.period)) throw new ApiError(400, 'period must be a month, like 2026-11')
    if (typeof b.currency !== 'string' || !/^[A-Z]{3}$/.test(b.currency)) throw new ApiError(400, 'currency must be a 3-letter code such as USD')
    const svc = supabaseService(), key = { org_id: profile.org_id, period: `${b.period}-01`, currency: b.currency }
    if (b.booked_target === null) {
      const { error } = await svc.from('revenue_plan').delete().match(key)
      if (error) throw new ApiError(400, error.message)
      await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'revenue_plan_cleared', entityType: 'organisation', entityId: profile.org_id, after: { period: b.period, currency: b.currency } })
      return NextResponse.json({ cleared: true })
    }
    const amount = (v: unknown, what: string) => { const x = Number(v); if (v === '' || v == null || typeof v === 'boolean' || !Number.isFinite(x) || x < 0 || x > 1e13) throw new ApiError(400, `${what} must be a number of 0 or more`); return Math.round(x * 100) / 100 }
    const booked = amount(b.booked_target, 'The booked target')
    const collected = b.collected_target == null || b.collected_target === '' ? null : amount(b.collected_target, 'The collected target')
    if (b.note != null && (typeof b.note !== 'string' || b.note.length > 300)) throw new ApiError(400, 'note can be at most 300 characters')
    const { error } = await svc.from('revenue_plan').upsert({ ...key, booked_target: booked, collected_target: collected, note: typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null, set_by: profile.id, updated_at: new Date().toISOString() }, { onConflict: 'org_id,period,currency' })
    if (error) throw new ApiError(400, error.message)
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'revenue_plan_set', entityType: 'organisation', entityId: profile.org_id, after: { period: b.period, currency: b.currency, booked_target: booked, collected_target: collected } })
    return NextResponse.json({ period: b.period, currency: b.currency, booked_target: booked, collected_target: collected })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
