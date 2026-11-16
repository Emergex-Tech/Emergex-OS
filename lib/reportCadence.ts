// Pure snapshot-cadence logic (L17) — dates are UTC calendar days (YYYY-MM-DD), so a run at 23:59 or 00:01 cannot disagree.
export const CADENCES = ['manual', 'daily', 'every_2_days', 'weekly', 'monthly'] as const
export type Cadence = (typeof CADENCES)[number]
export const CADENCE_LABEL: Record<Cadence, string> = { manual: 'Manual only', daily: 'Every day', every_2_days: 'Every other day', weekly: 'Every week', monthly: 'Every month' }

const ms = (d: string) => Date.parse(d + 'T00:00:00Z')
export const isIsoDay = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(ms(d)).toISOString().slice(0, 10) === d
export const addDays = (d: string, n: number) => new Date(ms(d) + n * 86_400_000).toISOString().slice(0, 10)
/** Month arithmetic that clamps to month-end (31 Jan + 1 month = 28/29 Feb), so "monthly" never skips or doubles a month. */
export function addMonths(d: string, n: number): string {
  const [y, m, day] = d.split('-').map(Number)
  const total = (y * 12 + (m - 1)) + n, ny = Math.floor(total / 12), nm = (total % 12) + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`
}
/** The next day a snapshot is due, or null when the cadence is manual. With no earlier snapshot it is due today. */
export function nextDue(cadence: Cadence, lastCadenceDay: string | null, today: string): string | null {
  if (cadence === 'manual') return null
  if (!lastCadenceDay) return today
  return cadence === 'daily' ? addDays(lastCadenceDay, 1) : cadence === 'every_2_days' ? addDays(lastCadenceDay, 2) : cadence === 'weekly' ? addDays(lastCadenceDay, 7) : addMonths(lastCadenceDay, 1)
}
export const isSnapshotDue = (cadence: Cadence, lastCadenceDay: string | null, today: string): boolean => { const d = nextDue(cadence, lastCadenceDay, today); return d !== null && d <= today }

/** How many days a snapshot is LATE: 0 when it is not due yet or is due today (the daily job has not had its chance), else whole days past its due day. */
export function overdueDays(cadence: Cadence, lastCadenceDay: string | null, today: string): number {
  const d = nextDue(cadence, lastCadenceDay, today)
  if (d === null || d >= today) return 0
  return Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(d + 'T00:00:00Z')) / 86_400_000)
}
