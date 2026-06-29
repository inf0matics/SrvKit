import { store } from '../../../../utils/srvkit.ts'
import { publicJob } from '../../../../utils/backups.ts'
import { registerJob, unregisterJob } from '../../../../utils/watcher.ts'
import { registerCron, unregisterCron, usesCron } from '../../../../utils/scheduler.ts'

// Enable / disable a job. Disabled jobs don't run — the filewatcher is stopped
// and the cron is paused; re-enabling re-registers the trigger immediately.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  if (!store().getJob(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }
  const body = await readBody<{ enabled?: unknown }>(event)
  store().setJobEnabled(id, body?.enabled === true)
  const job = store().getJob(id)!

  // register*/unregister* internally respect active + enabled.
  if (usesCron(job)) {
    unregisterJob(job.id)
    registerCron(job)
  } else {
    unregisterCron(job.id)
    registerJob(job)
  }
  return publicJob(job)
})
