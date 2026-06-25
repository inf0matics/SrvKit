import { store } from '../../../../utils/srvkit.ts'
import { parseJobInput } from '../../../../utils/backups.ts'
import { registerJob } from '../../../../utils/watcher.ts'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  if (!store().getJob(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }
  const body = await readBody<Record<string, unknown>>(event)
  store().updateJob(id, parseJobInput(body))
  const job = store().getJob(id)!
  registerJob(job) // re-register over the (possibly changed) selection
  return job
})
