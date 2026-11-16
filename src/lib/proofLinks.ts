// Which links may be attached as proof — PURE, and safe to import in the browser as well as on the server.
// A proof link is either a Google Drive/Docs file or a public social post. Only a plain https link on an EXACT known host is
// accepted, so a stored link can never be a javascript: URL, a look-alike host, or carry credentials.
export type Platform = 'drive' | 'instagram' | 'facebook' | 'x' | 'tiktok' | 'youtube'
const HOSTS: Record<string, Platform> = {
  'drive.google.com': 'drive', 'docs.google.com': 'drive',
  'instagram.com': 'instagram', 'www.instagram.com': 'instagram',
  'facebook.com': 'facebook', 'www.facebook.com': 'facebook', 'm.facebook.com': 'facebook', 'web.facebook.com': 'facebook', 'fb.watch': 'facebook',
  'x.com': 'x', 'www.x.com': 'x', 'twitter.com': 'x', 'www.twitter.com': 'x', 'mobile.twitter.com': 'x',
  'tiktok.com': 'tiktok', 'www.tiktok.com': 'tiktok', 'vt.tiktok.com': 'tiktok', 'vm.tiktok.com': 'tiktok',
  'youtube.com': 'youtube', 'www.youtube.com': 'youtube', 'm.youtube.com': 'youtube', 'youtu.be': 'youtube'
}
export const PLATFORM_LABEL: Record<Platform, string> = { drive: 'Google Drive', instagram: 'Instagram', facebook: 'Facebook', x: 'X', tiktok: 'TikTok', youtube: 'YouTube' }
export type ProofLink = { ok: true; url: string; platform: Platform } | { ok: false; reason: string }

export function parseProofLink(raw: unknown): ProofLink {
  if (typeof raw !== 'string') return { ok: false, reason: 'A link is required' }
  const s = raw.trim()
  if (!s) return { ok: false, reason: 'A link is required' }
  if (s.length > 600) return { ok: false, reason: 'That link is too long' }
  if (/\s/.test(s)) return { ok: false, reason: 'A link cannot contain spaces' }
  let u: URL
  try { u = new URL(s) } catch { return { ok: false, reason: 'That is not a valid link' } }
  if (u.protocol !== 'https:') return { ok: false, reason: 'Only https links are accepted' }
  if (u.username || u.password) return { ok: false, reason: 'A link cannot contain a username or password' }
  if (u.port) return { ok: false, reason: 'A link cannot name a port' }
  const platform = HOSTS[u.hostname.toLowerCase()]
  if (!platform) return { ok: false, reason: 'Only Google Drive links or Instagram, Facebook, X, TikTok and YouTube post links are accepted' }
  u.hash = ''
  return { ok: true, url: u.toString(), platform }
}
/** For rendering: the link again if (and only if) it still passes, else null. Checked when saved, when the report is built, and when drawn. */
export const safeProofLink = (u: unknown): string | null => { const r = parseProofLink(u); return r.ok ? r.url : null }
