import { setIpCheck } from '../../utils/peers.ts'

// Toggle the IP allowlist (restrict pings to the IP recorded at pairing).
export default defineEventHandler(async (event) => {
  const body = await readBody<{ ipAllowlist?: unknown }>(event)
  if (typeof body?.ipAllowlist !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'ipAllowlist (boolean) required' })
  }
  setIpCheck(body.ipAllowlist)
  return { ok: true, ipAllowlist: body.ipAllowlist }
})
