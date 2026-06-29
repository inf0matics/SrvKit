import type { H3Event } from 'h3'
import { openStore, type Store } from '../../lib/store.ts'
import { createRateLimiter } from '../../lib/rateLimit.ts'

/** Lazily-opened singleton store for the server process. */
let _store: Store | null = null
export function store(): Store {
  if (!_store) _store = openStore(databasePath())
  return _store
}

function databasePath(): string {
  return process.env.DATABASE_PATH || './.data/srvkit.db'
}

/** Session lifetime in seconds — 24h default, overridable via SESSION_TTL. */
export function sessionTtlSeconds(): number {
  const v = Number(process.env.SESSION_TTL)
  return Number.isFinite(v) && v > 0 ? v : 86_400
}

/**
 * Login rate limit: max 10 attempts per minute per IP. Module-level so the
 * window is shared across all requests in this single-container process.
 */
export const loginRateLimiter = createRateLimiter(10, 60_000)

/**
 * Pairing rate limit: max 20 attempts per 10 minutes per IP. The unauthenticated
 * /api/heartbeat/pair endpoint validates a one-time key; this caps brute force.
 */
export const pairRateLimiter = createRateLimiter(20, 10 * 60_000)

export interface AuthSessionData {
  authenticated?: boolean
}

/**
 * Resolve the auth session. The sealing password is read fresh from the store
 * each call, so when `setPassword` rotates the secret every previously-sealed
 * cookie fails to unseal — i.e. all sessions are invalidated instantly.
 *
 * `secure` defaults to on; e2e/dev over plain http set COOKIE_SECURE=false.
 */
export function getAuthSession(event: H3Event) {
  return useSession<AuthSessionData>(event, {
    name: 'srvkit_session',
    password: store().getSessionSecret(),
    maxAge: sessionTtlSeconds(),
    cookie: {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE !== 'false',
      sameSite: 'strict',
    },
  })
}

/** True when the request carries a valid, authenticated session. */
export async function isAuthenticated(event: H3Event): Promise<boolean> {
  if (!store().isInitialized()) return false
  const session = await getAuthSession(event)
  return session.data.authenticated === true
}
