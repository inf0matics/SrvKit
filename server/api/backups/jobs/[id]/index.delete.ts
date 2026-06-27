import { store } from '../../../../utils/srvkit.ts'
import { unregisterJob } from '../../../../utils/watcher.ts'
import { unregisterCron } from '../../../../utils/scheduler.ts'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!
  if (!store().deleteJob(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }
  unregisterJob(id)
  unregisterCron(id)
  return { ok: true }
})
