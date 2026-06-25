import { store } from '../../../../utils/srvkit.ts'
import { parseJobInput } from '../../../../utils/backups.ts'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  if (!store().getJob(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }
  const body = await readBody<Record<string, unknown>>(event)
  store().updateJob(id, parseJobInput(body))
  return store().getJob(id)
})
