import {
  getAuthSession,
  loginRateLimiter,
  store,
} from '../../utils/srvkit.ts'
import { verifyPassword } from '../../../lib/password.ts'

// Login is only meaningful once a password exists; mirrors the setup endpoint's
// 404 so `/` is the single place that decides setup-vs-login.
export default defineEventHandler(async (event) => {
  if (!store().isInitialized()) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  // Key on the raw socket address, NOT the X-Forwarded-For header: h3 trusts the
  // leftmost XFF value unconditionally, so a client could rotate it per request
  // to dodge the limit. Behind Traefik the socket IP is the proxy's (a global
  // cap, fine for a single-admin app); for per-client limits behind a trusted
  // proxy, set Traefik forwardedHeaders.trustedIPs and key on XFF there.
  const ip = getRequestIP(event) || 'unknown'
  const limit = loginRateLimiter.check(ip)
  if (!limit.allowed) {
    setResponseHeader(event, 'Retry-After', limit.retryAfter)
    throw createError({ statusCode: 429, statusMessage: 'Too many attempts' })
  }

  const body = await readBody<{ password?: unknown }>(event)
  if (!verifyPassword(body?.password, store().getPasswordHash())) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid password' })
  }

  const session = await getAuthSession(event)
  await session.update({ authenticated: true })
  return { ok: true }
})
