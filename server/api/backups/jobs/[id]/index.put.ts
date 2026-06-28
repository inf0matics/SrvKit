import { store } from '../../../../utils/srvkit.ts'
import { parseJobInput, publicJob } from '../../../../utils/backups.ts'
import { registerJob, unregisterJob } from '../../../../utils/watcher.ts'
import { registerCron, unregisterCron, usesCron } from '../../../../utils/scheduler.ts'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const existing = store().getJob(id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }
  const body = await readBody<Record<string, unknown>>(event)
  // Full validation — saving activates the job and starts its trigger.
  const input = parseJobInput(body)
  // A blank DB password (PostgreSQL/MySQL) means "keep the stored one".
  if (input.type === 'postgres' || input.type === 'mysql') {
    if (!input.dbPassword) input.dbPassword = existing.dbPassword
    if (!input.dbPassword) {
      throw createError({ statusCode: 400, statusMessage: 'Database password is required.' })
    }
  }
  store().updateJob(id, input)
  store().setJobActive(id, true)
  const job = store().getJob(id)!

  // Route activation to the job's trigger: cron schedule or filewatcher.
  if (usesCron(job)) {
    unregisterJob(job.id)
    registerCron(job)
  } else {
    unregisterCron(job.id)
    registerJob(job)
  }
  return publicJob(job)
})
