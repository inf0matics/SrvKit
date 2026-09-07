import { store } from '../../utils/srvkit.ts'
import { getServerName, getRepeatHours, setRepeatHours } from '../../utils/alerts.ts'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ serverName?: unknown; repeatHours?: unknown }>(event)
  if (typeof body?.serverName === 'string') {
    store().setConfig('server_name', body.serverName.trim())
  }
  if (typeof body?.repeatHours === 'number') {
    setRepeatHours(body.repeatHours)
  }
  return { serverName: getServerName(), repeatHours: getRepeatHours() }
})
