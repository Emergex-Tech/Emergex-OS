import { supabaseService } from './supabaseServer'
import { toCents, fromCents, paymentSummary, isOverdue, needsChase, daysBetween, invoiceNumber } from './billing'

export interface InvoiceView {
  id: string; number: string; direction: 'receivable' | 'payable'; contract_id: string
  counterparty_type: string; counterparty_name: string; description: string | null
  amount: number; currency: string; issue_date: string | null; due_date: string | null; status: string
  paid: number; balance: number; payment_status: 'unpaid' | 'part_paid' | 'paid'
  overdue: boolean; days_overdue: number; last_chased_at: string | null; needs_chase: boolean; created_at: string
}

export const today = () => new Date().toISOString().slice(0, 10)

/** Invoices with paid/balance/overdue DERIVED from payments and the due date — never read from a stored flag. */
export async function listInvoices(orgId: string, f: { direction?: string; contractId?: string; id?: string } = {}): Promise<InvoiceView[]> {
  const svc = supabaseService()
  let q = svc.from('invoices')
    .select('id, seq_no, direction, contract_id, counterparty_type, counterparty_name, description, amount, currency, issue_date, due_date, status, created_at, payments(amount), invoice_chases(created_at)')
    .eq('org_id', orgId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('seq_no', { ascending: true })
  if (f.direction) q = q.eq('direction', f.direction)
  if (f.contractId) q = q.eq('contract_id', f.contractId)
  if (f.id) q = q.eq('id', f.id)
  const { data, error } = await q
  if (error) throw new Error(`Could not load invoices: ${error.message}`)

  const now = today()
  return (data ?? []).map((r) => {
    const payments = (r.payments ?? []) as unknown as { amount: number }[]
    const chases = (r.invoice_chases ?? []) as unknown as { created_at: string }[]
    const amountCents = toCents(r.amount)
    const paidCents = payments.reduce((s, p) => s + toCents(p.amount), 0)
    const { balanceCents, status: paymentStatus } = paymentSummary(amountCents, paidCents)
    const overdue = isOverdue({ status: r.status, dueDate: r.due_date, balanceCents }, now)
    const last = chases.map((c) => c.created_at).sort().pop() ?? null
    return {
      id: r.id, number: invoiceNumber(r.direction, r.seq_no), direction: r.direction, contract_id: r.contract_id,
      counterparty_type: r.counterparty_type, counterparty_name: r.counterparty_name, description: r.description,
      amount: fromCents(amountCents), currency: r.currency, issue_date: r.issue_date, due_date: r.due_date, status: r.status,
      paid: fromCents(paidCents), balance: fromCents(balanceCents), payment_status: paymentStatus,
      overdue, days_overdue: overdue && r.due_date ? daysBetween(r.due_date, now) : 0,
      last_chased_at: last, needs_chase: overdue && needsChase(last, now), created_at: r.created_at
    }
  })
}
