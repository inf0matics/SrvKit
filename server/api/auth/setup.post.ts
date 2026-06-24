import { getAuthSession, store } from '../../utils/srvkit.ts'
import { hashPassword, isValidPassword } from '../../../lib/password.ts'

// First-start only. Sets the password and signs the user in. Returns 404 once
// initialized, so the setup endpoint cannot be used to overwrite a password.
export default defineEventHandler(async (event) => {
  if (store().isInitialized()) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const body = await readBody<{ password?: unknown }>(event)
  if (!isValidPassword(body?.password)) {
    throw createError({ statusCode: 400, statusMessage: 'Password must not be empty' })
  }

  store().setPassword(hashPassword(body.password))

  // getAuthSession reads the freshly-rotated secret, so the new cookie is sealed
  // with the post-setup key.
  const session = await getAuthSession(event)
  await session.update({ authenticated: true })
  return { ok: true }
})
