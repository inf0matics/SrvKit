import { recordPeerPing } from '../../utils/peers.ts'

// Ongoing heartbeat from a paired peer, authenticated by its bearer token and
// (optionally) its source IP against the one recorded at pairing.
export default defineEventHandler(async (event) => {
  const auth = getHeader(event, 'authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const body = await readBody<{ name?: unknown; intervalSec?: unknown }>(event)
  const name = typeof body?.name === 'string' ? body.name : ''
  // Senders on an older build don't report a cadence; the receiver then falls
  // back to its own configured interval.
  const intervalSec = Number(body?.intervalSec)
  const ip = getRequestIP(event, { xForwardedFor: true }) || ''

  const result = token
    ? recordPeerPing(token, name, ip, Number.isFinite(intervalSec) ? intervalSec : 0)
    : 'unknown'
  if (result === 'ip-mismatch') {
    console.warn(`[peers] ping rejected: IP ${ip} not allowed for this peer`)
    throw createError({ statusCode: 403, statusMessage: 'Source IP not allowed' })
  }
  if (result !== 'ok') throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return { ok: true }
})
