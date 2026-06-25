import { test, expect, type Page } from '@playwright/test'
import { writeFileSync, rmSync } from 'node:fs'

// Runs after auth.spec.ts (alphabetical). One shared page + a single login so it
// doesn't eat into the per-IP login rate limit.
const PASSWORD = 'correct horse battery staple e2e'

test.describe.serial('backups', () => {
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
    await page.goto('/app/backups')
  })

  test.afterAll(async () => {
    await page.close()
  })

  const content = () => page.getByTestId('backups')

  test('overview shows the empty state', async () => {
    await expect(page.getByText('No targets yet.')).toBeVisible()
  })

  test('tests the connection from the Add modal', async () => {
    await page.getByRole('button', { name: 'Add Target' }).click()
    await page.getByLabel('Host', { exact: true }).fill('http://127.0.0.1:1')
    await page.getByLabel('Username', { exact: true }).fill('alice')
    await page.getByLabel('Password', { exact: true }).fill('s3cret')
    await page.getByRole('button', { name: 'Test', exact: true }).click()
    await expect(page.locator('.overlay .test-err')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
  })

  test('adds a target (overview shows only name, host, Edit, Delete)', async () => {
    await page.getByRole('button', { name: 'Add Target' }).click()
    await page.getByLabel('Name', { exact: true }).fill('My Nextcloud')
    await page.getByLabel('Host', { exact: true }).fill('http://127.0.0.1:1')
    await page.getByLabel('Username', { exact: true }).fill('alice')
    await page.getByLabel('Password', { exact: true }).fill('s3cret')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(content().getByText('My Nextcloud')).toBeVisible()
    await expect(content().getByText('http://127.0.0.1:1')).toBeVisible()
    // No jobs / location / collapse on the overview anymore.
    await expect(page.getByTestId('location')).toHaveCount(0)
  })

  test('clicking the target opens its detail page', async () => {
    await content().getByRole('link', { name: 'My Nextcloud' }).click()
    await expect(page).toHaveURL(/\/app\/backups\/[0-9a-f-]+$/)
    await expect(page.getByTestId('target-page')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'My Nextcloud' })).toBeVisible()
    await expect(page.getByTestId('location')).toHaveText('/')
  })

  test('detail: directory browser errors on an unreachable share', async () => {
    await page.getByRole('button', { name: 'Choose location' }).click()
    await expect(page.getByTestId('browse-error')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
  })

  test('detail: choose a location by navigating the browser', async () => {
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
    await page.getByRole('button', { name: 'srvkit', exact: true }).click()
    await expect(page.getByRole('button', { name: 'home', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Select', exact: true }).click()
    await expect(page.getByTestId('location')).toHaveText('/srvkit')

    await page.unroute('**/api/backups/targets/*/browse')
  })

  test('detail: test connection reports an error for an unreachable host', async () => {
    await page.getByRole('button', { name: 'Test', exact: true }).click()
    await expect(page.locator('.test-err')).toBeVisible()
  })

  test('detail: create a job (lightweight modal → edit page)', async () => {
    await page.getByRole('button', { name: 'Add Job' }).click()
    // Lightweight modal: name, type, mounted path.
    await page.getByLabel('Name', { exact: true }).fill('Root configs')
    await page.getByLabel('Mounted path').selectOption('root')
    await page.getByRole('button', { name: 'Create' }).click()

    // Redirected to the full edit page; file tree loads.
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+\/edit$/)
    await expect(page.getByTestId('job-edit')).toBeVisible()
    await expect(page.getByText('.bashrc')).toBeVisible()

    await page.getByLabel('Nextcloud subdirectory').fill('root')
    // Edit-page archive preview shows the full host path (compact).
    await expect(page.getByTestId('archive')).toContainText(
      '127.0.0.1:1/srvkit/root/Root configs.tar.gz',
    )
    await page.getByRole('button', { name: 'Save' }).click()

    // Back on the target detail page.
    await expect(page).toHaveURL(/\/app\/backups\/[0-9a-f-]+$/)
    await expect(page.getByText('Root configs', { exact: true })).toBeVisible()
    await expect(page.getByTestId('job-type')).toHaveText('Files')
    await expect(page.getByTestId('job-dest')).toHaveText(
      '127.0.0.1:1/srvkit/root/Root configs.tar.gz',
    )
    await expect(page.getByTestId('job-status')).toHaveText('No backup yet')
  })

  test('detail: Run Now records a failed run (upload unreachable)', async () => {
    await expect(page.getByTestId('job-status')).toHaveText('No backup yet')
    await page.getByRole('button', { name: 'Run job now' }).click()
    // Failed run shows "Last backup: …" with the error inline.
    await expect(page.getByTestId('job-status')).toContainText('Upload failed')
    await expect(page.getByTestId('job-status')).toContainText('Last backup')
  })

  test('detail: edit a job opens the edit page', async () => {
    await page.getByRole('button', { name: 'Edit job' }).click()
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+\/edit$/)
    await page.getByLabel('Name', { exact: true }).fill('Root configs v2')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page).toHaveURL(/\/app\/backups\/[0-9a-f-]+$/)
    await expect(page.getByText('Root configs v2', { exact: true })).toBeVisible()
    await expect(page.getByTestId('job-dest')).toHaveText(
      '127.0.0.1:1/srvkit/root/Root configs v2.tar.gz',
    )
  })

  test('detail: a file change shows the debounce countdown', async () => {
    // The job watches tests/fixtures/sources/root; a new file there starts the
    // 10s debounce, which the row shows as a countdown.
    const trigger = 'tests/fixtures/sources/root/e2e-trigger.txt'
    writeFileSync(trigger, String(Date.now()))
    try {
      await expect(page.locator('.st-debounce')).toBeVisible({ timeout: 9000 })
      await expect(page.locator('.st-debounce')).toContainText(/\d+\s*s/)
    } finally {
      rmSync(trigger, { force: true })
    }
  })

  test('detail: delete the job (icon + inline confirm)', async () => {
    await page.getByRole('button', { name: 'Delete job' }).click()
    await expect(page.getByText('Delete this job?')).toBeVisible()
    await page.locator('.job').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByText('No backup jobs yet.')).toBeVisible()
  })

  test('detail: create a SQLite job (type + date suffix)', async () => {
    await page.getByRole('button', { name: 'Add Job' }).click()
    await page.getByLabel('Name', { exact: true }).fill('App DB')
    await page.getByLabel('Type').selectOption('sqlite')
    await page.getByLabel('Mounted path').selectOption('app.db')
    await page.getByRole('button', { name: 'Create' }).click()

    // Edit page: SQLite branch — read-only source file + date toggle, no tree.
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+\/edit$/)
    await expect(page.getByTestId('job-edit')).toBeVisible()
    await page.getByLabel('Append date to filename').check()
    await page.getByLabel('Nextcloud subdirectory').fill('db')
    await expect(page.getByTestId('archive')).toContainText(
      /App DB_\d{4}-\d{2}-\d{2}\.tar\.gz/,
    )
    await page.getByRole('button', { name: 'Save' }).click()

    // Detail: SQLite badge + dated destination.
    await expect(page).toHaveURL(/\/app\/backups\/[0-9a-f-]+$/)
    await expect(page.getByTestId('job-type')).toHaveText('SQLite')
    await expect(page.getByTestId('job-dest')).toContainText(
      /\/srvkit\/db\/App DB_\d{4}-\d{2}-\d{2}\.tar\.gz/,
    )
  })

  test('sidebar lists the target and links to its page', async () => {
    const link = page.locator('.subnav').getByRole('link', { name: 'My Nextcloud' })
    await expect(link).toBeVisible()
    await link.click()
    await expect(page).toHaveURL(/\/app\/backups\/[0-9a-f-]+$/)
    await expect(page.getByTestId('target-page')).toBeVisible()
  })

  test('overview: edit the target name', async () => {
    await page.goto('/app/backups')
    await page.getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Name', { exact: true }).fill('Renamed NC')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(content().getByText('Renamed NC')).toBeVisible()
  })

  test('overview: delete the target (icon + inline confirm)', async () => {
    await page.getByRole('button', { name: 'Delete target' }).click()
    await expect(page.getByText('Delete this target? All jobs will be lost.')).toBeVisible()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(content().getByText('Renamed NC')).toHaveCount(0)
    await expect(page.getByText('No targets yet.')).toBeVisible()
  })
})
