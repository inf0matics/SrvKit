import { store } from '../../utils/srvkit.ts'

// Stop monitoring + remove an incoming peer. It may keep pinging; we ignore it.
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!
  store().deletePeer(id)
  return { ok: true }
})
