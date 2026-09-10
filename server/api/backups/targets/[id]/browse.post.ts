import { store } from '../../../../utils/srvkit.ts'
import { normalizeRoot } from '../../../../utils/backups.ts'
import { driverForTarget } from '../../../../utils/target-driver.ts'

// List sub-directories of a path on the target, for the location picker.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const target = store().getTarget(id)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Target not found' })
  }
  const body = await readBody<Record<string, unknown>>(event)
  const path = normalizeRoot(body?.path)
  return driverForTarget(target).browse(path)
})
