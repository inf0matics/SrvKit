import { store } from '../../../utils/srvkit.ts'
import {
  encryptPassword,
  isValidHost,
  normalizeRoot,
  trimStr,
} from '../../../utils/backups.ts'

// Create a target. The password is encrypted before it ever touches the DB.
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const name = trimStr(body?.name)
  const host = trimStr(body?.host)
  const username = trimStr(body?.username)
  const password = typeof body?.password === 'string' ? body.password : ''
  const rootDir = normalizeRoot(body?.rootDir)

  if (!name || !host || !username || !password || !rootDir) {
    throw createError({
      statusCode: 400,
      statusMessage: 'name, host, username, password and root directory are required',
    })
  }
  if (!isValidHost(host)) {
    throw createError({ statusCode: 400, statusMessage: 'host must be an http(s) URL' })
  }

  return store().createTarget({
    name,
    host,
    username,
    password: encryptPassword(password),
    rootDir,
  })
})
