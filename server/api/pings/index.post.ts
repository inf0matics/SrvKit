import { createPing, readPings, type PingInput } from '../../utils/ping-monitor.ts'
import { normalizeUrl } from '../../../lib/ping-monitor.ts'

// Add a ping. Validates the URL (http/https only) then runs one silent check so
// the returned list already carries its status.
export default defineEventHandler(async (event) => {
  const body = await readBody<PingInput>(event)
  const url = normalizeUrl(body?.url ?? '')
  if (!url) {
    throw createError({ statusCode: 400, statusMessage: 'A valid http(s) URL is required.' })
  }
  await createPing(body, url)
  return readPings()
})
