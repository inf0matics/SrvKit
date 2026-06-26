import { store } from '../../utils/srvkit.ts'
import { getServerName } from '../../utils/alerts.ts'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ serverName?: unknown }>(event)
  if (typeof body?.serverName === 'string') {
    store().setConfig('server_name', body.serverName.trim())
  }
  return { serverName: getServerName() }
})
