import { test, expect } from '@playwright/test'

// Runs after auth.spec.ts (alphabetical, single worker) so its successful login
// flows aren't blocked. This test deliberately exhausts the per-IP login limit,
// so nothing requiring a successful login should run after it.
// The limit is raised for e2e so the suite's own logins fit (playwright.config.ts),
// so derive the attempt count from it rather than hardcoding one.
const LIMIT = Number(process.env.LOGIN_RATE_LIMIT) || 10

test('login endpoint rate-limits brute force with 429', async ({ request }) => {
  let saw429 = false
  for (let i = 0; i < LIMIT + 5; i++) {
    const res = await request.post('/api/auth/login', {
      data: { password: 'wrong-' + i },
    })
    if (res.status() === 429) {
      saw429 = true
      expect(res.headers()['retry-after']).toBeTruthy()
      break
    }
    expect(res.status()).toBe(401)
  }
  expect(saw429).toBe(true)
})
