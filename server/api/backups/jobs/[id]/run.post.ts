import { store } from '../../../../utils/srvkit.ts'
import { runBackup } from '../../../../utils/runner.ts'
import { publicJob } from '../../../../utils/backups.ts'

// Run a job immediately (manual trigger). Returns the job with its run result.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const job = store().getJob(id)
  if (!job) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }
  if (!job.active) {
    throw createError({ statusCode: 409, statusMessage: 'Configure and save the job first' })
  }
  await runBackup(id)
  return publicJob(store().getJob(id)!)
})
