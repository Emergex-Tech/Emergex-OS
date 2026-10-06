import { NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { supabaseService } from '@/lib/supabaseServer'
import { deliveryPct } from '@/lib/delivery'
import { errorResponse } from '@/lib/apiError'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const svc = supabaseService()
    const { data: contract, error } = await svc
      .from('contracts')
      .select('*, deals(proposal_id, proposals(brands(name)))')
      .eq('id', params.id).eq('org_id', profile.org_id).single()
    if (error || !contract) throw new ApiError(404, 'Contract not found')

    // deliverables has TWO foreign keys into profiles (owner_id, created_by), so a bare
    // `profiles(full_name)` embed is ambiguous and PostgREST errors — it has to be told which
    // relationship via the constraint name. (Found by this failing silently: the error wasn't
    // checked, so it looked like "no deliverables" instead of "the query errored.")
    const { data: deliverables, error: delError } = await svc
      .from('deliverables')
      .select('id, description, due_date, status, created_at, planned_quantity, delivered_quantity, unit, make_good_of, invoice_adjustment, adjustment_note, owner:profiles!deliverables_owner_id_fkey(full_name)')
      .eq('contract_id', params.id)
      .order('due_date', { ascending: true, nullsFirst: false })
    if (delError) throw new ApiError(400, `Could not load deliverables: ${delError.message}`)

    return NextResponse.json({
      ...contract,
      brand_name: (contract.deals as unknown as { proposals: { brands: { name: string } } })?.proposals?.brands?.name ?? '',
      deliverables: (deliverables ?? []).map((d) => ({ ...d, planned_quantity: Number(d.planned_quantity), delivered_quantity: Number(d.delivered_quantity), pct: deliveryPct(Number(d.planned_quantity), Number(d.delivered_quantity)), owner_name: (d.owner as unknown as { full_name: string } | null)?.full_name ?? null }))
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export const dynamic = 'force-dynamic'
