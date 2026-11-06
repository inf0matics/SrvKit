import { recordPeerPing } from '../../utils/peers.ts'
import { MAX_JOURNAL_ENTRIES, type SendFailure } from '../../../lib/peer-heartbeat.ts'
import type { PeerReport } from '../../../lib/store.ts'

const REASONS = new Set(['dns', 'refused', 'timeout', 'tls', 'http', 'unreachable'])

/**
 * A back-filled report of why this peer's heartbeats did not arrive. It comes
 * from the network, so every field is validated and bounded before it can end
 * up in an alert message.
 */
function parseReport(input: unknown): PeerReport | undefined {
  if (!input || typeof input !== 'object') return undefined
  const raw = input as { misses?: unknown; lastSuccessAt?: unknown }
  const misses: SendFailure[] = (Array.isArray(raw.misses) ? raw.misses : [])
    .filter((m): m is SendFailure => {
      const e = m as Partial<SendFailure>
      return (
        typeof e?.at === 'string' &&
        Number.isFinite(Date.parse(e.at)) &&
        typeof e?.reason === 'string' &&
        REASONS.has(e.reason) &&
        typeof e?.detail === 'string'
      )
    })
    .slice(-MAX_JOURNAL_ENTRIES)
    .map((m) => ({ at: m.at, reason: m.reason, detail: m.detail.slice(0, 200) }))
  const lastSuccessAt =
    typeof raw.lastSuccessAt === 'string' && Number.isFinite(Date.parse(raw.lastSuccessAt))
      ? raw.lastSuccessAt
      : null
  return { misses, lastSuccessAt }
}

// Ongoing heartbeat from a paired peer, authenticated by its bearer token and
// (optionally) its source IP against the one recorded at pairing.
export default defineEventHandler(async (event) => {
  const auth = getHeader(event, 'authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const body = await readBody<{
    name?: unknown
    intervalSec?: unknown
    misses?: unknown
    lastSuccessAt?: unknown
  }>(event)
  const name = typeof body?.name === 'string' ? body.name : ''
  // Senders on an older build report neither a cadence nor a reason; the
  // receiver then falls back to its own interval and says the cause is unknown.
  const intervalSec = Number(body?.intervalSec)
  const ip = getRequestIP(event, { xForwardedFor: true }) || ''

  const result = token
    ? recordPeerPing(
        token,
        name,
        ip,
        Number.isFinite(intervalSec) ? intervalSec : 0,
        parseReport(body),
      )
    : 'unknown'
  if (result === 'ip-mismatch') {
    console.warn(`[peers] ping rejected: IP ${ip} not allowed for this peer`)
    throw createError({ statusCode: 403, statusMessage: 'Source IP not allowed' })
  }
  if (result !== 'ok') throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return { ok: true }
})
