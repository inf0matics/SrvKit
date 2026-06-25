import { store } from '../../../../utils/srvkit.ts'
import { runBackup } from '../../../../utils/runner.ts'

// Run a job immediately (manual trigger). Returns the job with its run result.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  if (!store().getJob(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }
  await runBackup(id)
  return store().getJob(id)
})
