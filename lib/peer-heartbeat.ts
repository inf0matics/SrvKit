import { randomBytes } from 'node:crypto'

// Pure heartbeat helpers (no DB / no network) so they're unit-testable.

/** Miss window: a peer silent longer than this is CRIT. Mirrors the ping interval ×5. */
export const PEER_SILENCE_MS = 5 * 60 * 1000
export const PAIRING_KEY_TTL_MS = 10 * 60 * 1000

export type PeerStatus = 'ok' | 'crit'

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous 0/O/1/I

/** 8-char alphanumeric pairing key, displayed grouped as `XXXX-XXXX`. */
export function generatePairingKey(): string {
  const bytes = randomBytes(8)
  let k = ''
  for (let i = 0; i < 8; i++) k += KEY_ALPHABET[bytes[i]! % KEY_ALPHABET.length]
  return k
}

/** A long random bearer token a peer presents on every ping. */
export function generatePeerToken(): string {
  return randomBytes(32).toString('hex')
}

/** Normalise a user-entered key for comparison (strip spaces/dashes, upper-case). */
export function normalizeKey(key: string): string {
  return key.replace(/[\s-]/g, '').toUpperCase()
}

/** Group a key for display: `A3F7KP92` → `A3F7-KP92`. */
export function formatKey(key: string): string {
  const k = normalizeKey(key)
  return k.length === 8 ? `${k.slice(0, 4)}-${k.slice(4)}` : k
}

/** CRIT once a peer has been silent beyond the window, else OK. */
export function peerStatus(lastSeenMs: number, nowMs: number, windowMs = PEER_SILENCE_MS): PeerStatus {
  return nowMs - lastSeenMs > windowMs ? 'crit' : 'ok'
}

/** Aggregate for the sidebar badge: crit if any peer is silent, else ok. */
export function worstPeerStatus(statuses: PeerStatus[]): PeerStatus {
  return statuses.includes('crit') ? 'crit' : 'ok'
}

/** Validate a peer domain — must be a well-formed http(s) origin. */
export function normalizeDomain(input: string): string | null {
  try {
    const u = new URL(input.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.origin
  } catch {
    return null
  }
}
