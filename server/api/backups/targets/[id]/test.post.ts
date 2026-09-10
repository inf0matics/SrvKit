import { store } from '../../../../utils/srvkit.ts'
import { driverForTarget } from '../../../../utils/target-driver.ts'

// Test a stored target: a WebDAV PROPFIND, or a probe write into the local
// directory — whichever this target's driver does.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const target = store().getTarget(id)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Target not found' })
  }
  return driverForTarget(target).test()
})
