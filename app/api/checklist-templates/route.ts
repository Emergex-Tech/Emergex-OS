import { NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

export async function GET() {
  try {
    await requireProfile()
    const svc = supabaseService()
    const [t, i] = await Promise.all([svc.from('checklist_templates').select('key, name, description').order('key'), svc.from('checklist_template_items').select('id, template_key, phase_no, phase_name, side, title, auto_rule, position, active').order('phase_no').order('position')])
    if (t.error || i.error) throw new ApiError(500, (t.error ?? i.error)!.message)
    return NextResponse.json((t.data ?? []).map((x) => ({ ...x, items: (i.data ?? []).filter((it) => it.template_key === x.key) })))
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
