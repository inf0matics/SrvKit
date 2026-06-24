import { test, expect } from '@playwright/test'

// One server / one DB shared across these tests (booted in setup mode), so the
// order matters: setup happens once, then everything else assumes initialized.
test.describe.configure({ mode: 'serial' })

const PASSWORD = 'correct horse battery staple e2e'

test('first start shows the setup screen with a regenerable suggestion', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Initial Setup' })).toBeVisible()

  const suggestion = page.getByTestId('suggestion')
  await expect(suggestion).not.toHaveText('…')
  const first = (await suggestion.textContent())!.trim()
  expect(first.split(/\s+/)).toHaveLength(12)

  await page.getByRole('button', { name: 'Regenerate' }).click()
  await expect(suggestion).not.toHaveText(first)
})

test('completing setup signs you in and the session survives a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('Your own password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Save & continue' }).click()

  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByTestId('app-welcome')).toBeVisible()

  // Session persists across a full reload.
  await page.reload()
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByTestId('app-welcome')).toBeVisible()
})

test('setup endpoint is gone once initialized (404)', async ({ request }) => {
  const setup = await request.post('/api/auth/setup', { data: { password: 'x' } })
  expect(setup.status()).toBe(404)
  const suggestion = await request.get('/api/auth/suggestion')
  expect(suggestion.status()).toBe(404)
})

test('unauthenticated access to /app redirects to the login screen', async ({ page }) => {
  await page.goto('/app')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'SrvKit', exact: true })).toBeVisible()
  await expect(page.getByPlaceholder('Password')).toBeVisible()
})

test('wrong password shows an error, correct password signs in', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('Password').fill('definitely wrong')
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page.getByTestId('login-error')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)

  await page.getByPlaceholder('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page).toHaveURL(/\/app$/)

  // Log out returns to the login screen.
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByPlaceholder('Password')).toBeVisible()
})

test('"Can\'t login?" modal shows the CLI reset command', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: "Can't login?" }).click()
  const dialog = page.getByRole('dialog', { name: "Can't login?" })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('srvkit change-password')
})

// Run LAST: this exhausts the per-IP login rate limit for the current window.
test('login endpoint rate-limits brute force with 429', async ({ request }) => {
  let saw429 = false
  for (let i = 0; i < 15; i++) {
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
