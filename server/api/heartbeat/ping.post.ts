import { recordPeerPing } from '../../utils/peers.ts'

// Ongoing heartbeat from a paired peer, authenticated by its bearer token.
export default defineEventHandler(async (event) => {
  const auth = getHeader(event, 'authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const body = await readBody<{ name?: unknown }>(event)
  const name = typeof body?.name === 'string' ? body.name : ''
  if (!token || !recordPeerPing(token, name)) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  return { ok: true }
})
