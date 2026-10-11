import crypto from 'node:crypto'

/** A link token is 32 random bytes (256 bits) — 43 URL-safe characters. Unguessable; never stored, only its hash. */
export const newToken = (): string => crypto.randomBytes(32).toString('base64url')
export const hashToken = (t: string): string => crypto.createHash('sha256').update(t).digest('hex')
/** Cheap shape check so garbage never reaches the database. Failing it is treated exactly like "unknown link". */
export const isPlausibleToken = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t)

export const MAX_LINK_DAYS = 365
export const DEFAULT_LINK_DAYS = 30
/** Whole days, 1–365. Anything else is refused rather than clamped, so a typo never silently becomes a different lifetime. */
export function parseExpiryDays(v: unknown): { ok: true; days: number } | { ok: false; error: string } {
  const n = v == null ? DEFAULT_LINK_DAYS : v
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_LINK_DAYS) return { ok: false, error: `Expiry must be a whole number of days between 1 and ${MAX_LINK_DAYS}` }
  return { ok: true, days: n }
}
export type LinkState = 'active' | 'expired' | 'revoked'
/** Revoked beats expired: a revoked link stays "revoked" in the staff list even after its date passes. */
export function linkState(l: { expires_at: string; revoked_at: string | null }, nowMs = Date.now()): LinkState {
  if (l.revoked_at) return 'revoked'
  return Date.parse(l.expires_at) <= nowMs ? 'expired' : 'active'
}
/** Hashed PER LINK so a visitor cannot be followed from one link to another, and the raw address is never stored. */
export const ipHash = (ip: string | null | undefined, linkId: string): string | null => (ip ? crypto.createHash('sha256').update(`${linkId}|${ip}`).digest('hex').slice(0, 32) : null)
export const firstForwardedIp = (h: string | null): string | null => (h ? h.split(',')[0].trim().slice(0, 64) || null : null)

export const EXPIRING_SOON_DAYS = 7
/** Whole days until a link expires, rounded UP (a link with 20 hours left has "1 day left"); 0 or less = already expired. */
export const daysLeft = (expiresAt: string, nowMs = Date.now()): number => Math.ceil((Date.parse(expiresAt) - nowMs) / 86_400_000)
