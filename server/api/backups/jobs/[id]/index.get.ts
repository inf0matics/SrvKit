import { store } from '../../../../utils/srvkit.ts'
import { jobState } from '../../../../utils/watcher.ts'
import { publicJob } from '../../../../utils/backups.ts'
import { nextRun } from '../../../../../lib/cron.ts'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!
  const job = store().getJob(id)
  if (!job) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }
  return { ...publicJob(job), ...jobState(job), nextRun: nextRun(job.schedule) }
})
