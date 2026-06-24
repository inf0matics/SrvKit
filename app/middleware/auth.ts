// Client-side guard for SPA navigation into `/app`. Full-page loads are already
// protected by the server middleware (server/middleware/guard.ts).
export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.server) return
  const { authenticated } = await $fetch<{ authenticated: boolean }>(
    '/api/auth/status',
  )
  if (!authenticated) return navigateTo('/')
})
