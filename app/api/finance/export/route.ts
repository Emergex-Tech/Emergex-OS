import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, writeAudit } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { listInvoices } from '@/lib/finance'
import { toCsv } from '@/lib/billing'
import { errorResponse } from '@/lib/apiError'

const INVOICE_COLS = [
  { key: 'number', label: 'Number' }, { key: 'direction', label: 'Direction' }, { key: 'counterparty_type', label: 'Counterparty type' },
  { key: 'counterparty_name', label: 'Counterparty' }, { key: 'description', label: 'Description' }, { key: 'currency', label: 'Currency' },
  { key: 'amount', label: 'Amount' }, { key: 'paid', label: 'Paid' }, { key: 'balance', label: 'Balance' }, { key: 'issue_date', label: 'Issue date' },
  { key: 'due_date', label: 'Due date' }, { key: 'status', label: 'Status' }, { key: 'payment_status', label: 'Payment status' }
]

/**
 * B11: CSV for the accounting tool. D11 (WHICH tool, and push vs export) is still undecided in the PRD,
 * so this is a plain, tool-agnostic export — import it, or map the columns in whatever you pick.
 */
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    await requirePermission(profile, 'finance.manage')
    const kind = req.nextUrl.searchParams.get('kind')
    if (!['receivables', 'payables', 'payments'].includes(kind ?? '')) throw new ApiError(400, "kind must be 'receivables', 'payables' or 'payments'")

    let csv: string
    if (kind === 'payments') {
      const { data, error } = await supabaseService().from('payments')
        .select('amount, paid_on, method, reference, invoices(seq_no, direction, counterparty_name, currency)').eq('org_id', profile.org_id).order('paid_on')
      if (error) throw new ApiError(400, error.message)
      csv = toCsv(
        [{ key: 'invoice', label: 'Invoice' }, { key: 'counterparty', label: 'Counterparty' }, { key: 'currency', label: 'Currency' }, { key: 'amount', label: 'Amount' }, { key: 'paid_on', label: 'Paid on' }, { key: 'method', label: 'Method' }, { key: 'reference', label: 'Reference' }],
        (data ?? []).map((p) => {
          const inv = p.invoices as unknown as { seq_no: number; direction: string; counterparty_name: string; currency: string }
          return { invoice: `${inv.direction === 'receivable' ? 'INV' : 'BILL'}-${String(inv.seq_no).padStart(5, '0')}`, counterparty: inv.counterparty_name, currency: inv.currency, amount: p.amount, paid_on: p.paid_on, method: p.method, reference: p.reference }
        }))
    } else {
      const direction = kind === 'receivables' ? 'receivable' : 'payable'
      const rows = (await listInvoices(profile.org_id, { direction })).filter((i) => i.status !== 'void')
      csv = toCsv(INVOICE_COLS, rows as unknown as Record<string, unknown>[])
    }
    await writeAudit({ orgId: profile.org_id, actorId: profile.id, action: 'finance_exported', entityType: 'finance', entityId: profile.org_id, after: { kind } })
    return new NextResponse(csv, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="emergex-${kind}-${new Date().toISOString().slice(0, 10)}.csv"` } })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
