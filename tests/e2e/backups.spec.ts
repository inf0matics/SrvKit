import { test, expect, type Page } from '@playwright/test'

// Runs after auth.spec.ts (alphabetical). Uses one shared page + a single login
// so it doesn't eat into the per-IP login rate limit.
const PASSWORD = 'correct horse battery staple e2e'

test.describe.serial('backup targets', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    await page.goto('/')
    // Whichever state the shared server is in: first-start setup or login.
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
    await page.goto('/app/backups')
  })

  test.afterAll(async () => {
    await page.close()
  })

  test('shows the empty state with no targets', async () => {
    await expect(page.getByText('No targets yet.')).toBeVisible()
  })

  test('tests the connection from inside the Add modal', async () => {
    await page.getByRole('button', { name: 'Add Target' }).click()
    await page.getByLabel('Host', { exact: true }).fill('http://127.0.0.1:1')
    await page.getByLabel('Username', { exact: true }).fill('alice')
    await page.getByLabel('Password', { exact: true }).fill('s3cret')
    await page.getByRole('button', { name: 'Test', exact: true }).click()
    await expect(page.locator('.overlay .test-err')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
  })

  test('adds a target', async () => {
    await page.getByRole('button', { name: 'Add Target' }).click()
    await page.getByLabel('Name', { exact: true }).fill('My Nextcloud')
    await page.getByLabel('Host', { exact: true }).fill('http://127.0.0.1:1')
    await page.getByLabel('Username', { exact: true }).fill('alice')
    await page.getByLabel('Password', { exact: true }).fill('s3cret')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText('My Nextcloud')).toBeVisible()
    await expect(page.getByText('http://127.0.0.1:1')).toBeVisible()
    // Location defaults to the share root.
    await expect(page.getByTestId('location')).toHaveText('/')
  })

  test('directory browser shows an error when the share is unreachable', async () => {
    await page.getByRole('button', { name: 'Choose location' }).click()
    await expect(page.getByTestId('browse-error')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
  })

  test('chooses a location by navigating the directory browser', async () => {
    // Mock the WebDAV listing so navigation works without a live Nextcloud.
    await page.route('**/api/backups/targets/*/browse', async (route) => {
      const path = route.request().postDataJSON()?.path || ''
      const dirs =
        path === ''
          ? ['backups', 'documents', 'srvkit']
          : path === 'srvkit'
            ? ['home', 'root']
            : []
      await route.fulfill({ json: { ok: true, path, dirs } })
    })

    await page.getByRole('button', { name: 'Choose location' }).click()
    // Root listing, then navigate into srvkit.
    await page.getByRole('button', { name: 'srvkit', exact: true }).click()
    await expect(page.getByRole('button', { name: 'home', exact: true })).toBeVisible()
    // Select the current folder → persisted as the target root.
    await page.getByRole('button', { name: 'Select', exact: true }).click()
    await expect(page.getByTestId('location')).toHaveText('/srvkit')

    await page.unroute('**/api/backups/targets/*/browse')
  })

  test('test connection reports an error for an unreachable host', async () => {
    await page.getByRole('button', { name: 'Test', exact: true }).click()
    await expect(page.locator('.test-err')).toBeVisible()
  })

  test('edits the target name', async () => {
    await page.getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Name', { exact: true }).fill('Renamed NC')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Renamed NC')).toBeVisible()
  })

  test('creates a Files backup job via the wizard', async () => {
    await page.getByRole('button', { name: '+ New Backup' }).click()

    // Step 1 — name & type (Files is the default).
    await page.getByLabel('Name', { exact: true }).fill('Root configs')
    await page.getByRole('button', { name: 'Next' }).click()

    // Step 2 — pick a source; its file tree renders with everything checked.
    await page.getByLabel('Source path').selectOption('root')
    await expect(page.getByText('.bashrc')).toBeVisible()
    await expect(page.getByText('configs', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()

    // Step 3 — destination.
    await page.getByLabel('Nextcloud subdirectory').fill('root')
    await page.getByRole('button', { name: 'Save' }).click()

    // Job shows under its target.
    await expect(page.getByText('Root configs')).toBeVisible()
    await expect(page.getByText('root → root/Root configs.tar.gz')).toBeVisible()

    // Clean up the job so the target Delete button stays unambiguous.
    page.once('dialog', (d) => d.accept())
    await page.locator('.job').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('No backup jobs yet.')).toBeVisible()
  })

  test('deletes the target', async () => {
    page.once('dialog', (d) => d.accept())
    await page.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('Renamed NC')).toHaveCount(0)
    await expect(page.getByText('No targets yet.')).toBeVisible()
  })
})
