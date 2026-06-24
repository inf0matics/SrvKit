import { createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'

// bcrypt cost factor — see spec ("bcrypt, cost factor 12").
const COST = 12

/**
 * bcrypt silently truncates its input at 72 bytes. A 12-word BIP39 passphrase
 * is routinely longer than that, which would mean only the first ~10 words
 * actually contribute to the hash. Pre-hashing with SHA-256 (hex digest, a
 * fixed 64 ASCII bytes, no embedded NULs) lets the *entire* passphrase count
 * while staying well under bcrypt's limit. Every code path that touches a
 * password goes through here, so setup, login and the CLI stay consistent.
 */
function prehash(password: string): string {
  return createHash('sha256').update(password, 'utf8').digest('hex')
}

/** A password is acceptable as long as it is a non-blank string. */
export function isValidPassword(password: unknown): password is string {
  return typeof password === 'string' && password.trim().length > 0
}

export function hashPassword(password: string): string {
  if (!isValidPassword(password)) {
    throw new Error('Password must not be empty')
  }
  return bcrypt.hashSync(prehash(password), COST)
}

export function verifyPassword(password: unknown, hash: string | null): boolean {
  if (typeof password !== 'string' || !hash) return false
  return bcrypt.compareSync(prehash(password), hash)
}
