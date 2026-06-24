import { isValidHost, testWebdav, trimStr } from '../../../utils/backups.ts'

// Test connection with credentials supplied in the body (used by the Add/Edit
// modal before a target is saved). Distinct from /targets/:id/test, which tests
// an already-stored target.
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
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

  return testWebdav(host, username, password)
})
