import crypto from 'node:crypto'

// A temporary password an admin can read once and hand to a new user, not something they're expected to remember.
// Avoids visually ambiguous characters (0/O, 1/l/I) since it's typically read aloud or copy-pasted under time pressure.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

export function generateTempPassword(length = 14): string {
  return Array.from(crypto.randomBytes(length), (b) => ALPHABET[b % ALPHABET.length]).join('')
}
