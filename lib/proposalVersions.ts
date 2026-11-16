import { supabaseService } from './supabaseServer'
import { writeAudit } from './serviceLayer'
import type { Profile } from '@/types/db'

// A version snapshot is BRAND-FACING ONLY: item, quantity, sell price. Cost and
// margin never go in here, which is what lets proposal_versions be readable by
// every internal role without undoing the D10 decision (Team must not see margin).
export interface VersionLine {
  line_id: string
  item_id: string
  item_name: string
  quantity: number
  sell_price: number
}
export interface VersionSnapshot {
  currency: string
  lines: VersionLine[]
  total: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function totalOf(lines: VersionLine[]): number {
  return round2(lines.reduce((sum, l) => sum + l.sell_price * l.quantity, 0))
}

export async function buildSnapshot(proposalId: string): Promise<VersionSnapshot> {
  const svc = supabaseService()
  const { data: proposal } = await svc.from('proposals').select('currency').eq('id', proposalId).single()
  const { data: lines } = await svc
    .from('proposal_lines')
    .select('id, item_id, quantity, sell_price, items(name)')
    .eq('proposal_id', proposalId)
    .order('created_at', { ascending: true })

  const versionLines: VersionLine[] = (lines ?? []).map((l) => ({
    line_id: l.id,
    item_id: l.item_id,
    item_name: (l.items as unknown as { name: string } | null)?.name ?? '(unknown item)',
    quantity: Number(l.quantity),
    sell_price: round2(Number(l.sell_price))
  }))
  return { currency: proposal?.currency ?? 'USD', lines: versionLines, total: totalOf(versionLines) }
}

/** Human-readable change record between two snapshots. Empty string means "no change". */
export function diffSnapshots(prev: VersionSnapshot | null, next: VersionSnapshot): string {
  if (!prev) return `Initial version (${next.lines.length} line${next.lines.length === 1 ? '' : 's'}, total ${next.currency} ${next.total.toLocaleString()})`

  const prevById = new Map(prev.lines.map((l) => [l.line_id, l]))
  const nextById = new Map(next.lines.map((l) => [l.line_id, l]))
  const changes: string[] = []

  for (const l of next.lines) {
    const before = prevById.get(l.line_id)
    if (!before) { changes.push(`Added ${l.item_name} (${l.quantity} × ${l.sell_price.toLocaleString()})`); continue }
    if (before.sell_price !== l.sell_price) changes.push(`${l.item_name}: price ${before.sell_price.toLocaleString()} → ${l.sell_price.toLocaleString()}`)
    if (before.quantity !== l.quantity) changes.push(`${l.item_name}: quantity ${before.quantity} → ${l.quantity}`)
  }
  for (const l of prev.lines) if (!nextById.has(l.line_id)) changes.push(`Removed ${l.item_name}`)
  if (prev.currency !== next.currency) changes.push(`Currency ${prev.currency} → ${next.currency}`)

  return changes.join('; ')
}

/**
 * Returns the latest version if nothing has changed since it (so exporting twice
 * doesn't mint a new version each time); otherwise writes the next version with
 * a change record against the previous one.
 */
export async function getOrCreateVersion(params: { profile: Profile; proposalId: string; note?: string | null }) {
  const svc = supabaseService()
  const snapshot = await buildSnapshot(params.proposalId)

  const { data: latest } = await svc
    .from('proposal_versions')
    .select('id, version_number, snapshot, change_summary, note, created_at')
    .eq('proposal_id', params.proposalId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const summary = diffSnapshots((latest?.snapshot as VersionSnapshot | null) ?? null, snapshot)
  if (latest && summary === '') return { version: latest, created: false }

  const { data: version, error } = await svc
    .from('proposal_versions')
    .insert({
      org_id: params.profile.org_id,
      proposal_id: params.proposalId,
      version_number: (latest?.version_number ?? 0) + 1,
      snapshot,
      change_summary: summary,
      note: params.note ?? null,
      created_by: params.profile.id
    })
    .select('id, version_number, snapshot, change_summary, note, created_at')
    .single()
  if (error) throw new Error(error.message)

  await writeAudit({
    orgId: params.profile.org_id, actorId: params.profile.id, action: 'version_created',
    entityType: 'proposal', entityId: params.proposalId, after: { version_number: version.version_number, change_summary: summary }
  })
  return { version, created: true }
}
