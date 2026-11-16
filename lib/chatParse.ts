// Pure parser for pasted WhatsApp / Telegram chat exports (L30) — no database, no AI.
// It only READS the text and proposes entries; a person reviews them and confirms before anything is saved.

export const MAX_CHARS = 200_000
export const MAX_MESSAGES = 500
export interface ParsedMessage { index: number; occurred_at: string; sender: string; text: string }
export interface ParseResult { format: 'whatsapp_ios' | 'whatsapp_android' | 'telegram' | 'unknown'; messages: ParsedMessage[]; skippedSystem: number; invalidDates: number; truncated: boolean; error?: string }
export interface ParseOptions { dateOrder?: 'dmy' | 'mdy'; utcOffsetMinutes?: number }

const T = String.raw`(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?`
const D = String.raw`(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4}),?\s+`
const IOS = new RegExp(String.raw`^\[${D}${T}\]\s+([^:]+?):\s(.*)$`)
const IOS_ANY = new RegExp(String.raw`^\[${D}${T}\]\s+(.*)$`)
const ANDROID = new RegExp(String.raw`^${D}${T}\s+-\s+([^:]+?):\s(.*)$`)
const ANDROID_ANY = new RegExp(String.raw`^${D}${T}\s+-\s+(.*)$`)
const TELEGRAM = /^(.+?),\s+\[(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*$/
const INVISIBLE = /[\u200e\u200f\u202a-\u202e\ufeff]/g

/** A real calendar date and time, or null — "31/02" and "13:75" are refused rather than silently rolled over. */
function toIso(a: number, b: number, year: number, hour: number, min: number, sec: number, ampm: string | undefined, order: 'dmy' | 'mdy', offset: number): string | null {
  const day = order === 'dmy' ? a : b, month = order === 'dmy' ? b : a
  const y = year < 100 ? 2000 + year : year
  let h = hour
  if (ampm) { if (hour < 1 || hour > 12) return null; h = (hour % 12) + (/^p/i.test(ampm) ? 12 : 0) } else if (hour > 23) return null
  if (min > 59 || sec > 59) return null
  const t = Date.UTC(y, month - 1, day, h, min, sec)
  const d = new Date(t)
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return new Date(t - offset * 60_000).toISOString()
}

export function parseChat(raw: string, opts: ParseOptions = {}): ParseResult {
  const order = opts.dateOrder ?? 'dmy', offset = opts.utcOffsetMinutes ?? 0
  const empty = (format: ParseResult['format'], error?: string): ParseResult => ({ format, messages: [], skippedSystem: 0, invalidDates: 0, truncated: false, ...(error ? { error } : {}) })
  if (typeof raw !== 'string' || !raw.trim()) return empty('unknown', 'Paste the chat first')
  if (raw.length > MAX_CHARS) return empty('unknown', `That is more than ${MAX_CHARS.toLocaleString('en-US')} characters — paste it in smaller parts`)
  const lines = raw.replace(INVISIBLE, '').split(/\r?\n/)

  const count = (re: RegExp) => lines.filter((l) => re.test(l)).length
  const scores = [['whatsapp_ios', count(IOS)], ['whatsapp_android', count(ANDROID)], ['telegram', count(TELEGRAM)]] as const
  const best = [...scores].sort((x, y) => y[1] - x[1])[0]
  if (best[1] === 0) return empty('unknown')
  const format = best[0]

  const out: { sender: string; text: string; at: string }[] = []
  let cur: { sender: string; text: string; at: string } | null = null
  let skippedSystem = 0, invalidDates = 0
  const flush = () => { if (cur && cur.text.trim()) out.push({ ...cur, text: cur.text.trim() }); cur = null }
  for (const line of lines) {
    if (format === 'telegram') {
      const m = line.match(TELEGRAM)
      if (m) { flush(); const at = toIso(+m[2], +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7] : 0, undefined, 'dmy', offset); if (at) cur = { sender: m[1].trim(), text: '', at }; else invalidDates++; continue }
      if (cur && line.trim()) cur.text += (cur.text ? '\n' : '') + line
      continue
    }
    const [msgRe, anyRe] = format === 'whatsapp_ios' ? [IOS, IOS_ANY] : [ANDROID, ANDROID_ANY]
    const m = line.match(msgRe)
    if (m) {
      flush()
      const at = toIso(+m[1], +m[2], +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, m[7], order, offset)
      if (at) cur = { sender: m[8].trim(), text: m[9], at }; else invalidDates++
      continue
    }
    if (anyRe.test(line)) { flush(); skippedSystem++; continue }   // a timestamped line with no "Name:" — "messages are encrypted", "X joined", …
    if (cur && line.trim()) cur.text += '\n' + line                  // a continuation of the previous message
  }
  flush()
  const truncated = out.length > MAX_MESSAGES
  return { format, messages: out.slice(0, MAX_MESSAGES).map((m, i) => ({ index: i, occurred_at: m.at, sender: m.sender, text: m.text })), skippedSystem, invalidDates, truncated }
}

export type SuggestedKind = 'request' | 'approval' | 'proof' | 'update'
/** A SUGGESTION only (the reviewer can change every one): questions and "please / can you / let me know" read as requests. */
export function suggestKind(text: string): SuggestedKind {
  const t = text.trim()
  if (/\?\s*$/.test(t) || /\b(please|pls|kindly|can you|could you|can we|need you|need the|need to|let me know|send me|share the|confirm)\b/i.test(t)) return 'request'
  if (/\b(approved|approve|go ahead|signed off|sign off|sounds good|looks good|ok to proceed|agreed)\b/i.test(t)) return 'approval'
  if (/<attached|image omitted|video omitted|screenshot|\bproof\b|photo|\.(png|jpg|jpeg|pdf)\b/i.test(t)) return 'proof'
  return 'update'
}

/** The summary stored in the log: the message itself, with the sender's name kept in front when no party was chosen for them. */
export function formatSummary(sender: string, text: string, partyChosen: boolean): { summary: string; truncated: boolean } {
  const s = partyChosen ? text.trim() : `${sender}: ${text.trim()}`
  return s.length > 2000 ? { summary: s.slice(0, 1999) + '…', truncated: true } : { summary: s, truncated: false }
}
export const dedupeKey = (occurredAtIso: string, direction: string, summary: string) => `${new Date(occurredAtIso).toISOString()}|${direction}|${summary.trim()}`
