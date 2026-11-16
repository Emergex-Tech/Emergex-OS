// Pure closure logic (L22) — no database.

export interface ClosureFacts {
  hasContract: boolean
  requestsOpen: number; requestsWaitingOnUs: number
  deliverablesOpen: number          // planned or partial: not finished, not missed, not replaced
  missedUnresolved: number          // missed, with no make-good and no invoice-adjustment flag
  stepsOpen: number                 // checklist steps still open (N/A and ticked ones excluded)
  invoicesOutstanding: number       // non-void receivables not fully paid — a COUNT only, never an amount
  proofMissing: number
}
export interface ClosureIssue { code: string; count: number; detail: string }

const n = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`

/**
 * Closing is a DECISION, not a gate: nothing here blocks it. Every issue is shown, closing with any of them needs an explicit
 * acknowledgement and a written reason, and the list is recorded on the project — so a project is never "quietly" closed
 * with work outstanding. Most serious first.
 */
export function closureIssues(f: ClosureFacts): ClosureIssue[] {
  const out: ClosureIssue[] = []
  if (f.requestsWaitingOnUs > 0) out.push({ code: 'waiting_on_us', count: f.requestsWaitingOnUs, detail: `${n(f.requestsWaitingOnUs, 'request is', 'requests are')} still waiting on us` })
  if (f.missedUnresolved > 0) out.push({ code: 'missed_unresolved', count: f.missedUnresolved, detail: `${n(f.missedUnresolved, 'missed deliverable has', 'missed deliverables have')} no make-good and no invoice adjustment` })
  if (f.deliverablesOpen > 0) out.push({ code: 'deliverables_open', count: f.deliverablesOpen, detail: `${n(f.deliverablesOpen, 'deliverable is', 'deliverables are')} not finished` })
  if (f.invoicesOutstanding > 0) out.push({ code: 'invoices_outstanding', count: f.invoicesOutstanding, detail: `${n(f.invoicesOutstanding, 'invoice is', 'invoices are')} not fully paid` })
  if (f.proofMissing > 0) out.push({ code: 'proof_missing', count: f.proofMissing, detail: `${n(f.proofMissing, 'delivered deliverable has', 'delivered deliverables have')} no proof on file` })
  const otherRequests = f.requestsOpen - f.requestsWaitingOnUs
  if (otherRequests > 0) out.push({ code: 'waiting_on_them', count: otherRequests, detail: `${n(otherRequests, 'request is', 'requests are')} still waiting on someone else` })
  if (f.stepsOpen > 0) out.push({ code: 'steps_open', count: f.stepsOpen, detail: `${n(f.stepsOpen, 'checklist step is', 'checklist steps are')} still open` })
  if (!f.hasContract) out.push({ code: 'no_contract', count: 1, detail: 'there is no contract, so there are no deliverables on record' })
  return out
}

/** Closing with issues needs the acknowledgement AND a real reason (not just whitespace). */
export function closureDecision(issues: ClosureIssue[], acknowledge: unknown, note: unknown): { ok: true; note: string | null } | { ok: false; error: string } {
  const text = typeof note === 'string' ? note.trim() : ''
  if (text.length > 1000) return { ok: false, error: 'The closing note can be at most 1000 characters' }
  if (issues.length === 0) return { ok: true, note: text || null }
  if (acknowledge !== true) return { ok: false, error: 'This project still has open items. Review them and confirm you want to close it anyway.' }
  if (text.length < 5) return { ok: false, error: 'Closing with open items needs a reason on record (at least a few words)' }
  return { ok: true, note: text }
}
