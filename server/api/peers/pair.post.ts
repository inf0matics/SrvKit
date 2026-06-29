import { normalizeDomain } from '../../../lib/peer-heartbeat.ts'
import { setOutgoing, sendPing } from '../../utils/peers.ts'
import { getServerName } from '../../utils/alerts.ts'

// Step 3 of pairing: submit the copied key to the target. On success we store
// the returned bearer token as our outgoing target and send a first heartbeat.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ domain?: unknown; key?: unknown }>(event)
  const domain = typeof body?.domain === 'string' ? normalizeDomain(body.domain) : null
  const key = typeof body?.key === 'string' ? body.key.trim() : ''
  if (!domain) throw createError({ statusCode: 400, statusMessage: 'Enter a valid https:// domain' })
  if (!key) throw createError({ statusCode: 400, statusMessage: 'key required' })

  const label = getServerName() || getRequestURL(event).host
  let res: Response
  try {
    res = await fetch(`${domain}/api/heartbeat/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: label, key }),
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Could not reach a SrvKit at that domain' })
  }
  if (!res.ok) {
    throw createError({ statusCode: 401, statusMessage: 'Pairing failed — check the key and try again' })
  }

  const token = ((await res.json()) as { token?: string }).token
  if (!token) throw createError({ statusCode: 502, statusMessage: 'Peer did not return a token' })

  setOutgoing(domain, token)
  await sendPing() // first heartbeat right away so the peer learns our name
  return { ok: true }
})
