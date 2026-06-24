import { store } from '../../../../utils/srvkit.ts'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!
  if (!store().deleteTarget(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Target not found' })
  }
  return { ok: true }
})
