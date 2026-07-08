import { deletePing, readPings } from '../../utils/ping-monitor.ts'

// Remove a ping.
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!
  if (!deletePing(id)) throw createError({ statusCode: 404, statusMessage: 'Ping not found.' })
  return readPings()
})
