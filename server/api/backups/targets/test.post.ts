import {
  isValidHost,
  normalizeRoot,
  parseTargetType,
  trimStr,
} from '../../../utils/backups.ts'
import { driverFor, isValidLocalRoot } from '../../../utils/target-driver.ts'

// Test connection with details supplied in the body (used by the Add/Edit modal
// before a target is saved). Distinct from /targets/:id/test, which tests an
// already-stored target.
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const type = parseTargetType(body?.type)

  if (type === 'local') {
    const rootDir = normalizeRoot(body?.rootDir)
    if (!isValidLocalRoot(rootDir)) {
      return {
        ok: false,
        message: 'Path is outside the allowed backup targets directory',
      }
    }
    return driverFor({ type, host: '', username: '', password: '', rootDir }).test()
  }

  const host = trimStr(body?.host)
  const username = trimStr(body?.username)
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!host || !username || !password) {
    throw createError({
      statusCode: 400,
      statusMessage: 'host, username and password are required to test',
    })
  }
  if (!isValidHost(host)) {
    throw createError({ statusCode: 400, statusMessage: 'host must be an http(s) URL' })
  }

  return driverFor({ type, host, username, password, rootDir: '' }).test()
})
