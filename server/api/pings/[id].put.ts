import { updatePing, readPings, type PingPatch } from '../../utils/ping-monitor.ts'
import { normalizeUrl } from '../../../lib/ping-monitor.ts'

// Edit a ping (URL / name / expected code / frequency) or flip its enabled
// toggle. A changed URL is validated up-front.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<PingPatch>(event)

  let url: string | null = null
  if (typeof body?.url === 'string') {
    url = normalizeUrl(body.url)
    if (!url) {
      throw createError({ statusCode: 400, statusMessage: 'A valid http(s) URL is required.' })
    }
  }

  const ok = await updatePing(id, body ?? {}, url)
  if (!ok) throw createError({ statusCode: 404, statusMessage: 'Ping not found.' })
  return readPings()
})
