// Pure money logic — no database, no network — so every rule here is directly testable.
// All arithmetic is done in INTEGER CENTS: splitting 12,000.01 three ways in floating point
// would drift by fractions of a cent; in cents the instalments always sum to exactly the total.

export const toCents = (n: number | string): number => Math.round(Number(n) * 100)
export const fromCents = (c: number): number => c / 100

const ISO = /^\d{4}-\d{2}-\d{2}$/
export function isValidIsoDate(s: string): boolean {
  if (!ISO.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86_400_000)
}

/** Month arithmetic that clamps to the last day (Jan 31 + 1 month = Feb 28/29, not Mar 3). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const total = m - 1 + months
  const ny = y + Math.floor(total / 12)
  const nm = ((total % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`
}

export interface ScheduleItem { seq: number; amountCents: number; dueDate: string }

/**
 * B6: split a contract's total into instalments. Any leftover cents go on the LAST instalment, so
 * the schedule always sums to exactly the total. Each due date is computed from the FIRST date
 * (not from the previous one), so a Jan 31 start stays on month-ends: Jan 31, Feb 28, Mar 31.
 */
export function buildSchedule(p: { totalCents: number; installments: number; firstDueDate: string; intervalMonths: number }): ScheduleItem[] {
  const { totalCents, installments, firstDueDate, intervalMonths } = p
  if (!Number.isInteger(totalCents) || totalCents <= 0) throw new Error('The contract total must be greater than zero')
  if (!Number.isInteger(installments) || installments < 1 || installments > 60) throw new Error('installments must be a whole number from 1 to 60')
  if (!Number.isInteger(intervalMonths) || intervalMonths < 1 || intervalMonths > 12) throw new Error('interval_months must be a whole number from 1 to 12')
  if (!isValidIsoDate(firstDueDate)) throw new Error('first_due_date must be a valid date (YYYY-MM-DD)')
  const base = Math.floor(totalCents / installments)
  if (base < 1) throw new Error('The total is too small to split into that many instalments')
  const remainder = totalCents - base * installments
  return Array.from({ length: installments }, (_, k) => ({
    seq: k + 1,
    amountCents: base + (k === installments - 1 ? remainder : 0),
    dueDate: addMonths(firstDueDate, k * intervalMonths)
  }))
}

export type PaymentStatus = 'unpaid' | 'part_paid' | 'paid'
export function paymentSummary(amountCents: number, paidCents: number): { balanceCents: number; status: PaymentStatus } {
  return {
    balanceCents: amountCents - paidCents,
    status: paidCents >= amountCents ? 'paid' : paidCents > 0 ? 'part_paid' : 'unpaid'
  }
}

/** B10: overdue means issued, still owed, and past its due date. Drafts and voids never are. */
export function isOverdue(inv: { status: string; dueDate: string | null; balanceCents: number }, todayIso: string): boolean {
  return inv.status === 'issued' && inv.balanceCents > 0 && !!inv.dueDate && inv.dueDate < todayIso
}

/** A chase reminder: due if never chased, or last chased `thresholdDays` or more ago. */
export function needsChase(lastChaseIso: string | null, todayIso: string, thresholdDays = 7): boolean {
  if (!lastChaseIso) return true
  return daysBetween(lastChaseIso.slice(0, 10), todayIso) >= thresholdDays
}

export const invoiceNumber = (direction: string, seqNo: number): string =>
  `${direction === 'receivable' ? 'INV' : 'BILL'}-${String(seqNo).padStart(5, '0')}`

// ---------- B8: payables, derived from what a won deal actually cost ----------
export interface PayableLine { vendorId: string | null; vendorName: string | null; quantity: number; costUsed: number; agentCutAmount: number }
export interface AgentPayee { id: string | null; name: string | null; cutMethod: string; fixedFee: number }
export interface PayableDraft { counterpartyType: 'vendor' | 'agent'; counterpartyId: string | null; counterpartyName: string; amountCents: number; description: string }

/**
 * One payable per vendor (sum of cost × quantity across that vendor's lines), plus one to the
 * agent for their cut. A fixed-fee agent is paid the fee ONCE — their cut is stored on every
 * line, so summing it would pay them once per line. Lines whose item has no vendor recorded are
 * grouped under "Unassigned vendor" rather than silently dropped, and counted so the caller can warn.
 */
export function buildPayables(lines: PayableLine[], agent: AgentPayee | null): { payables: PayableDraft[]; unassignedLines: number } {
  const byVendor = new Map<string, { id: string | null; name: string; cents: number }>()
  let unassigned = 0
  for (const l of lines) {
    const key = l.vendorId ?? '__none__'
    if (!l.vendorId) unassigned++
    const row = byVendor.get(key) ?? { id: l.vendorId, name: l.vendorName ?? 'Unassigned vendor', cents: 0 }
    row.cents += toCents(l.costUsed * l.quantity)
    byVendor.set(key, row)
  }
  const payables: PayableDraft[] = Array.from(byVendor.values())
    .filter((v) => v.cents > 0)
    .map((v) => ({ counterpartyType: 'vendor' as const, counterpartyId: v.id, counterpartyName: v.name, amountCents: v.cents, description: `Cost of goods — ${v.name}` }))

  if (agent && agent.cutMethod !== 'none') {
    const cents = agent.cutMethod === 'fixedFee'
      ? toCents(agent.fixedFee)
      : lines.reduce((s, l) => s + toCents(l.agentCutAmount * l.quantity), 0)
    if (cents > 0) payables.push({ counterpartyType: 'agent', counterpartyId: agent.id, counterpartyName: agent.name ?? 'Agent', amountCents: cents, description: 'Agent commission' })
  }
  return { payables, unassignedLines: unassigned }
}

// ---------- B11: CSV for the accounting tool (D11, the tool itself, is still undecided) ----------
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v)
  // CSV injection: a text cell starting with = + - @ is run as a formula by Excel/Sheets. Numbers are exempt.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
  return s
}
export function toCsv(columns: { key: string; label: string }[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map((c) => csvCell(c.label)).join(',')]
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c.key])).join(','))
  return lines.join('\r\n') + '\r\n'
}
