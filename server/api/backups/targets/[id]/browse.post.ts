import { store } from '../../../../utils/srvkit.ts'
import {
  browseWebdav,
  decryptPassword,
  normalizeRoot,
} from '../../../../utils/backups.ts'

// List sub-directories of a path on the target's share, for the location picker.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const target = store().getTarget(id)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Target not found' })
  }
  const body = await readBody<Record<string, unknown>>(event)
  const path = normalizeRoot(body?.path)
  const password = decryptPassword(target.password)
  return browseWebdav(target.host, target.username, password, path)
})
