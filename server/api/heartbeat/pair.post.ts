import { pairPeer } from '../../utils/peers.ts'
import { getServerName } from '../../utils/alerts.ts'
import { pairRateLimiter } from '../../utils/srvkit.ts'

// A connecting peer submits the pairing key it copied from this instance.
// On success we register it and hand back the bearer token for its pings.
export default defineEventHandler(async (event) => {
  const limit = pairRateLimiter.check(getRequestIP(event) || 'unknown')
  if (!limit.allowed) {
    setResponseHeader(event, 'Retry-After', limit.retryAfter)
    throw createError({ statusCode: 429, statusMessage: 'Too many attempts' })
  }

  const body = await readBody<{ domain?: unknown; key?: unknown }>(event)
  if (typeof body?.key !== 'string' || !body.key.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'key required' })
  }
  const label = typeof body?.domain === 'string' ? body.domain : ''
  const ip = getRequestIP(event, { xForwardedFor: true }) || ''
  const token = pairPeer(label, body.key, ip)
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Invalid or expired pairing key' })
  return { token, name: getServerName() || 'SrvKit' }
})
