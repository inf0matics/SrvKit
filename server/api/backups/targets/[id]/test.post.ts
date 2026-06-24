import { store } from '../../../../utils/srvkit.ts'
import { decryptPassword, testWebdav } from '../../../../utils/backups.ts'

// Test connection: decrypt the stored password and run a WebDAV PROPFIND.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const target = store().getTarget(id)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Target not found' })
  }
  const password = decryptPassword(target.password)
  return testWebdav(target.host, target.username, password)
})
