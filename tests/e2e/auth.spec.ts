import { test, expect } from '@playwright/test'

// One server / one DB shared across these tests (booted in setup mode), so the
// order matters: setup happens once, then everything else assumes initialized.
// The brute-force / rate-limit test lives in its own spec so these login flows
// never trip the per-IP limit.
test.describe.configure({ mode: 'serial' })

const PASSWORD = 'correct horse battery staple e2e'

test('first start shows the setup screen with a regenerable suggestion', async ({ page }) => {
  await page.goto('/')
  // Setup mode is identified by the suggestion + Save button (hero heading is
  // always the "SrvKit" wordmark).
  await expect(page.getByRole('button', { name: 'Save & continue' })).toBeVisible()

  const suggestion = page.getByTestId('suggestion')
  await expect(suggestion).not.toHaveText('…')
  const first = (await suggestion.textContent())!.trim()
  expect(first.split(/\s+/)).toHaveLength(12)

  await page.getByRole('button', { name: 'Regenerate' }).click()
  await expect(suggestion).not.toHaveText(first)
})

test('completing setup lands on the dashboard shell and survives a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('Your own passphrase').fill(PASSWORD)
  await page.getByRole('button', { name: 'Save & continue' }).click()

  // /app redirects to /app/dashboard, rendered inside the shell.
  await expect(page).toHaveURL(/\/app\/dashboard$/)
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByTestId('dashboard')).toBeVisible()

  // Session persists across a full reload.
  await page.reload()
  await expect(page).toHaveURL(/\/app\/dashboard$/)
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
})

test('login screen shows the SrvKit hero, tagline and version', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('img', { name: 'SrvKit' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'SrvKit', exact: true })).toBeVisible()
  await expect(
    page.getByText('Host monitoring, Docker health, automated backups.'),
  ).toBeVisible()
  await expect(page.getByTestId('version')).toHaveText(/^SrvKit · v\d+\.\d+\.\d+$/)
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
  await expect(page.getByPlaceholder('Passphrase')).toBeVisible()
})

test('unauthenticated access to /app/dashboard also redirects', async ({ page }) => {
  await page.goto('/app/dashboard')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByPlaceholder('Passphrase')).toBeVisible()
})

test('wrong password shows an error, correct password reaches the dashboard', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('Passphrase').fill('definitely wrong')
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page.getByTestId('login-error')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)

  await page.getByPlaceholder('Passphrase').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/dashboard$/)
  await expect(page.getByText('SrvKit')).toBeVisible() // sidebar wordmark
})

test('logout endpoint clears the session', async ({ page }) => {
  // Sign in, then log out via the API (no logout UI in this shell spec).
  await page.goto('/')
  await page.getByPlaceholder('Passphrase').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/dashboard$/)

  const res = await page.request.post('/api/auth/logout')
  expect(res.ok()).toBe(true)

  // Session gone → protected route bounces back to login.
  await page.goto('/app/dashboard')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByPlaceholder('Passphrase')).toBeVisible()
})

test('"Can\'t login?" modal shows the CLI reset command', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: "Can't login?" }).click()
  const dialog = page.getByRole('dialog', { name: "Can't login?" })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('srvkit change-password')
})
