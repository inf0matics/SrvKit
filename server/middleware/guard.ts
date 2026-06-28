import { getAuthSession, store } from '../utils/srvkit.ts'

// Guards protected surfaces:
//   /app, /app/*       → full-page / SSR loads, redirect to login when unauthed
//   /api/backups/*     → JSON APIs, 401 when unauthed
// (Client-side SPA nav into /app is also covered by the Nuxt route middleware.)
export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0]

  const isAppPage = path === '/app' || path.startsWith('/app/')
  const isProtectedApi =
    path.startsWith('/api/backups') ||
    path.startsWith('/api/fs') ||
    path.startsWith('/api/settings') ||
    path.startsWith('/api/alerts') ||
    path.startsWith('/api/dashboard') ||
    path.startsWith('/api/docker') ||
    path.startsWith('/api/host')
  if (!isAppPage && !isProtectedApi) return

  const session = await getAuthSession(event)
  const authed =
    store().isInitialized() && session.data.authenticated === true

  if (!authed) {
    if (isProtectedApi) {
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }
    await sendRedirect(event, '/', 302)
    return
  }

  // Sliding inactivity window: re-seal on each authenticated hit.
  await session.update({ authenticated: true })
})
