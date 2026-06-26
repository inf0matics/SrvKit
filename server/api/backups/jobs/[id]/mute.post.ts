import { store } from '../../../../utils/srvkit.ts'

// Mute / unmute a job: suppresses its alerts without disabling the job.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ muted?: unknown }>(event)
  const muted = body?.muted === true
  if (!store().setJobMuted(id, muted)) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }
  return store().getJob(id)
})
