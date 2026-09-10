import { store } from '../../../utils/srvkit.ts'
import {
  encryptPassword,
  isSafeTargetRoot,
  isValidHost,
  normalizeRoot,
  parseTargetType,
  trimStr,
} from '../../../utils/backups.ts'
import { isValidLocalRoot } from '../../../utils/target-driver.ts'

// Create a target. A Nextcloud target's password is encrypted before it ever
// touches the DB; a local target stores no credentials at all.
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const type = parseTargetType(body?.type)
  const name = trimStr(body?.name)
  // Root defaults to the share root ("/"); chosen later via the directory browser.
  const rootDir = normalizeRoot(body?.rootDir)

  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'name is required' })
  }
  // Every job path is joined onto this root, so it must stay inside the share.
  if (!isSafeTargetRoot(rootDir)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'root directory must stay inside the share',
    })
  }

  if (type === 'local') {
    if (!isValidLocalRoot(rootDir)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'directory is outside the allowed backup targets directory',
      })
    }
    return store().createTarget({
      name,
      type,
      host: '',
      username: '',
      password: '',
      rootDir,
    })
  }

  const host = trimStr(body?.host)
  const username = trimStr(body?.username)
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!host || !username || !password) {
    throw createError({
      statusCode: 400,
      statusMessage: 'host, username and password are required',
    })
  }
  if (!isValidHost(host)) {
    throw createError({ statusCode: 400, statusMessage: 'host must be an http(s) URL' })
  }

  return store().createTarget({
    name,
    type,
    host,
    username,
    password: encryptPassword(password),
    rootDir,
  })
})
