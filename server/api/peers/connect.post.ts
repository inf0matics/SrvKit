import { normalizeDomain } from '../../../lib/peer-heartbeat.ts'

// Step 1 of pairing: probe the target SrvKit (server-side, so no CORS). A
// success makes the target generate + display a pairing key for the user.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ domain?: unknown }>(event)
  const domain = typeof body?.domain === 'string' ? normalizeDomain(body.domain) : null
  if (!domain) throw createError({ statusCode: 400, statusMessage: 'Enter a valid https:// domain' })

  try {
    const res = await fetch(`${domain}/api/heartbeat/probe`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(String(res.status))
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Could not reach a SrvKit at that domain' })
  }
  return { ok: true, domain }
})
