import { setHeartbeatTiming, timingView } from '../../utils/peers.ts'

// Heartbeat timing: send interval + how many missed heartbeats to tolerate.
// Values out of range are clamped rather than refused, so the UI cannot wedge
// the watchdog with a typo.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ intervalSec?: unknown; missThreshold?: unknown }>(event)
  if (body?.intervalSec === undefined && body?.missThreshold === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'intervalSec or missThreshold required' })
  }
  setHeartbeatTiming({ intervalSec: body?.intervalSec, missThreshold: body?.missThreshold })
  return { ok: true, timing: timingView() }
})
