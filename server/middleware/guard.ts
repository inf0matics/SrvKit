import { getAuthSession, store } from '../utils/srvkit.ts'

// Hard server-side guard for `/app` on full-page / SSR loads. Client-side SPA
// navigation is covered separately by the Nuxt route middleware.
export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0]
  if (path !== '/app' && !path.startsWith('/app/')) return

  const session = await getAuthSession(event)
  if (!store().isInitialized() || session.data.authenticated !== true) {
    await sendRedirect(event, '/', 302)
    return
  }

  // Sliding inactivity window: re-seal on each authenticated hit so the TTL
  // measures time since last activity rather than since login.
  await session.update({ authenticated: true })
})
