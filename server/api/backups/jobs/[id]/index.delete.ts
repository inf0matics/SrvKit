import { store } from '../../../../utils/srvkit.ts'
import { unregisterJob } from '../../../../utils/watcher.ts'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!
  if (!store().deleteJob(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }
  unregisterJob(id)
  return { ok: true }
})
