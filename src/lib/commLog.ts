import { ApiError } from './auth'

export interface CommFields { direction: 'inbound' | 'outbound'; channel: string; kind: string; summary: string; occurredAt: string }
export const COMM_CHANNELS = ['whatsapp', 'telegram', 'email', 'call', 'meeting', 'other']
export const COMM_KINDS = ['request', 'approval', 'update', 'proof', 'other']

/** The ONE definition of a valid log entry — used by the manual form AND the chat import, so they can never disagree. */
export function validateCommFields(b: Record<string, unknown>, now = Date.now()): CommFields {
  if (!['inbound', 'outbound'].includes(b.direction as string)) throw new ApiError(400, "direction must be 'inbound' or 'outbound'")
  if (!COMM_CHANNELS.includes(b.channel as string)) throw new ApiError(400, 'channel is not valid')
  if (!COMM_KINDS.includes(b.kind as string)) throw new ApiError(400, 'kind is not valid')
  const summary = typeof b.summary === 'string' ? b.summary.trim() : ''
  if (!summary || summary.length > 2000) throw new ApiError(400, 'A summary of 1–2000 characters is required')
  let occurredAt = new Date(now).toISOString()
  if (b.occurred_at != null) {
    const t = Date.parse(String(b.occurred_at))
    if (!Number.isFinite(t)) throw new ApiError(400, 'occurred_at is not a valid date')
    if (t > now + 86_400_000) throw new ApiError(400, 'occurred_at cannot be in the future')
    occurredAt = new Date(t).toISOString()
  }
  return { direction: b.direction as 'inbound' | 'outbound', channel: b.channel as string, kind: b.kind as string, summary, occurredAt }
}
