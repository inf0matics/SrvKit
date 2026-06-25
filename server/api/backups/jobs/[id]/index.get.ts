import { store } from '../../../../utils/srvkit.ts'
import { jobState } from '../../../../utils/watcher.ts'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!
  const job = store().getJob(id)
  if (!job) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }
  return { ...job, ...jobState(job) }
})
