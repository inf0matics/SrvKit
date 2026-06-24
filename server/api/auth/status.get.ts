import { getAuthSession, store } from '../../utils/srvkit.ts'

// Drives the `/` page: setup form when not initialized, login form otherwise.
export default defineEventHandler(async (event) => {
  const initialized = store().isInitialized()
  const session = await getAuthSession(event)
  return {
    initialized,
    authenticated: initialized && session.data.authenticated === true,
  }
})
