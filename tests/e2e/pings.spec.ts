import { test, expect, type Page } from '@playwright/test'

// Runs after backups.spec.ts (alphabetical). One shared page + a single login.
// Pings target the e2e server itself so OK/CRIT are deterministic:
//   http://localhost:3100/           → 200 (public landing)  → OK   vs expected 200
//   http://localhost:3100/nope-404   → 404 (unknown route)   → CRIT vs expected 200
const PASSWORD = 'correct horse battery staple e2e'
const OK_URL = 'http://localhost:3100/'
const BAD_URL = 'http://localhost:3100/nope-404-xyz'

test.describe.serial('pings', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    await page.goto('/')
    const setup = await page
      .getByRole('button', { name: 'Save & continue' })
      .isVisible()
      .catch(() => false)
    if (setup) {
      await page.getByPlaceholder('Your own passphrase').fill(PASSWORD)
      await page.getByRole('button', { name: 'Save & continue' }).click()
    } else {
      await page.getByPlaceholder('Passphrase').fill(PASSWORD)
      await page.getByRole('button', { name: 'Login', exact: true }).click()
    }
    await page.waitForURL(/\/app\/dashboard$/)
  })

  test.afterAll(async () => {
    await page.close()
  })

  const row = (url: string) => page.locator('.ping-row', { hasText: url })

  test('sidebar entry opens /app/pings (empty state, no badge)', async () => {
    await page.getByRole('link', { name: 'Pings', exact: true }).click()
    await expect(page).toHaveURL(/\/app\/pings$/)
    await expect(page.getByTestId('pings')).toBeVisible()
    await expect(page.getByTestId('pings-empty')).toBeVisible()
    // No pings enabled → no sidebar badge.
    await expect(page.getByTestId('pings-badge')).toHaveCount(0)
  })

  test('add a ping → appears in the list as enabled and OK', async () => {
    await page.getByTestId('add-ping').click()
    await page.getByTestId('form-url').fill(OK_URL)
    await page.getByTestId('form-name').fill('Landing')
    await page.getByTestId('form-frequency').selectOption('60')
    await page.getByTestId('form-save').click()

    const r = row(OK_URL)
    await expect(r).toBeVisible()
    await expect(r.getByText('Landing')).toBeVisible()
    await expect(r.getByRole('checkbox')).toBeChecked()
    // Immediate silent check on create → OK badge without waiting for the poll.
    await expect(r.getByTestId('ping-badge')).toHaveText('OK')
  })

  test('a wrong-status URL shows CRIT', async () => {
    await page.getByTestId('add-ping').click()
    await page.getByTestId('form-url').fill(BAD_URL)
    await page.getByTestId('form-frequency').selectOption('60')
    await page.getByTestId('form-save').click()

    const r = row(BAD_URL)
    await expect(r).toBeVisible()
    await expect(r.getByTestId('ping-badge')).toHaveText('CRIT')
  })

  test('an invalid URL is rejected inline', async () => {
    await page.getByTestId('add-ping').click()
    await page.getByTestId('form-url').fill('not-a-url')
    await page.getByTestId('form-save').click()
    await expect(page.getByTestId('form-error')).toBeVisible()
    await page.getByTestId('form-cancel').click()
  })

  test('sidebar badge reflects the worst status (CRIT)', async () => {
    await page.goto('/app/pings') // full reload re-mounts the sidebar
    await expect(page.getByTestId('pings-badge')).toHaveText('CRIT')
  })

  test('disabling the failing ping greys the row and clears its badge', async () => {
    const r = row(BAD_URL)
    await r.locator('.switch').click() // toggle off (label click; the input is visually hidden)
    await expect(r.getByRole('checkbox')).not.toBeChecked()
    await expect(r.locator('.metric-row.disabled')).toBeVisible()
    await expect(r.getByTestId('ping-badge')).toHaveCount(0)

    // Only the healthy ping is enabled now → sidebar badge is OK.
    await page.goto('/app/pings')
    await expect(page.getByTestId('pings-badge')).toHaveText('OK')
  })

  test('delete both pings → empty state and no badge', async () => {
    await row(BAD_URL).getByRole('button', { name: /^Delete/ }).click()
    await expect(row(BAD_URL)).toHaveCount(0)
    await row(OK_URL).getByRole('button', { name: /^Delete/ }).click()
    await expect(page.getByTestId('pings-empty')).toBeVisible()

    await page.goto('/app/pings')
    await expect(page.getByTestId('pings-badge')).toHaveCount(0)
  })
})
