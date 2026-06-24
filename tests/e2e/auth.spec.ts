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
  await expect(page.getByRole('link', { name: 'Backups' })).toBeVisible()
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
  // Footer: GitHub link + version badge linking to the GitHub release page.
  await expect(page.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
    'href',
    /github\.com/,
  )
  const ver = page.getByTestId('version')
  await expect(ver).toHaveText(/^v\d+\.\d+\.\d+$/)
  await expect(ver).toHaveAttribute('href', /\/releases\/tag\/v\d/)
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

test('unauthenticated access to /app/backups also redirects', async ({ page }) => {
  await page.goto('/app/backups')
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

test('sidebar Backups link opens /app/backups', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('Passphrase').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/dashboard$/)

  await page.getByRole('link', { name: 'Backups' }).click()
  await expect(page).toHaveURL(/\/app\/backups$/)
  await expect(page.getByTestId('backups')).toBeVisible()
})

test('sidebar Logout button ends the session', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('Passphrase').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/dashboard$/)

  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByPlaceholder('Passphrase')).toBeVisible()

  // Session really gone — protected route bounces back to login.
  await page.goto('/app/dashboard')
  await expect(page).toHaveURL(/\/$/)
})

test('sidebar bottom nav: theme toggle persists, tip jar hidden, github + version', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('Passphrase').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/dashboard$/)

  // Defaults to dark, toggles to light, and the choice survives a reload.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Light mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('button', { name: 'Dark mode' })).toBeVisible()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  // Tip Jar hidden when TIP_JAR_URL is unset (the e2e default).
  await expect(page.getByRole('link', { name: 'Tip Jar' })).toHaveCount(0)

  // GitHub link + version badge present.
  await expect(page.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
    'href',
    /github\.com/,
  )
  await expect(page.getByTestId('sidebar-version')).toHaveText(/^v\d+\.\d+\.\d+$/)
})

test('"Can\'t login?" modal shows the CLI reset command', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: "Can't login?" }).click()
  const dialog = page.getByRole('dialog', { name: "Can't login?" })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('srvkit change-password')
})
