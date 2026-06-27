import { test, expect, type Page } from '@playwright/test'
import { writeFileSync, readFileSync } from 'node:fs'

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
    // Tab title: no server name set yet.
    await expect(page).toHaveTitle('SrvKit | Backups')
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
    // Tab title uses the target name for the detail page.
    await expect(page).toHaveTitle('SrvKit | My Nextcloud')
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

  test('detail: create a job — modal is name + type; job starts inactive', async () => {
    await page.getByRole('button', { name: 'Add Job' }).click()
    // Minimal modal: name + type + an info box describing the type.
    await page.getByLabel('Name', { exact: true }).fill('Root configs')
    await expect(page.getByTestId('type-info')).toContainText('tar.gz archive')
    await page.getByRole('button', { name: 'Create' }).click()

    // Redirected to the edit page; the job exists but is not yet configured.
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+\/edit$/)
    await page.getByRole('link', { name: 'Cancel' }).click()

    // On the detail page the job shows as inactive with Run Now disabled.
    await expect(page).toHaveURL(/\/app\/backups\/[0-9a-f-]+$/)
    await expect(page.getByText('Root configs', { exact: true })).toBeVisible()
    await expect(page.getByTestId('job-status')).toHaveText('Not configured')
    await expect(page.getByRole('button', { name: 'Run job now' })).toBeDisabled()
  })

  test('detail: configure + save activates the job', async () => {
    await page.getByRole('button', { name: 'Edit job' }).click()
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+\/edit$/)

    // Pick a source dir; the lazy tree loads with nothing selected.
    await page.getByLabel('Source path').selectOption('root')
    await expect(page.getByText('.bashrc')).toBeVisible()
    // Lazy expand: subfolder children load only on demand.
    await expect(page.getByText('app.conf')).toHaveCount(0)
    await page.getByRole('button', { name: 'Expand' }).first().click()
    await expect(page.getByText('app.conf')).toBeVisible()

    // Saving with nothing selected is rejected.
    await page.getByLabel('Nextcloud subdirectory').fill('root')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Select at least one file to back up.')).toBeVisible()

    // Selecting a file inside a folder marks that folder as partially selected.
    const configsRow = page.locator('.row', { hasText: 'configs' })
    await expect(configsRow.getByTestId('partial-indicator')).toHaveCount(0)
    await page.getByRole('checkbox', { name: 'app.conf' }).check()
    await expect(configsRow.getByTestId('partial-indicator')).toBeVisible()

    // Select a top-level file too, then save → job becomes active.
    await page.getByRole('checkbox', { name: '.bashrc' }).check()
    await expect(page.getByTestId('archive')).toContainText(
      '127.0.0.1:1/srvkit/root/Root configs.tar.gz',
    )
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page).toHaveURL(/\/app\/backups\/[0-9a-f-]+$/)
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

  test('dashboard: the failed job opens an incident that links to the job', async () => {
    await page.goto('/app/dashboard')
    await expect(page.getByTestId('metric-jobs')).toContainText('1')
    const incident = page.getByTestId('incident-row')
    await expect(incident).toContainText('Root configs')
    await expect(incident).toContainText('My Nextcloud')
    await expect(incident).toContainText('since')

    await incident.click()
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+\/edit$/)

    // Back to the target detail page for the following tests.
    await page.locator('.subnav').getByRole('link', { name: 'My Nextcloud' }).click()
    await expect(page.getByTestId('target-page')).toBeVisible()
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
    // The job watches the selected file tests/fixtures/sources/root/.bashrc;
    // touching it starts the 10s debounce, shown as a countdown. Restore after.
    const watched = 'tests/fixtures/sources/root/.bashrc'
    const orig = readFileSync(watched, 'utf8')
    writeFileSync(watched, orig + '\n# e2e ' + Date.now())
    try {
      await expect(page.locator('.st-debounce')).toBeVisible({ timeout: 9000 })
      await expect(page.locator('.st-debounce')).toContainText(/\d+\s*s/)
    } finally {
      writeFileSync(watched, orig)
    }
  })

  test('detail: delete the job (icon + inline confirm)', async () => {
    await page.getByRole('button', { name: 'Delete job' }).click()
    await expect(page.getByText('Delete this job?')).toBeVisible()
    await page.locator('.job').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByText('No backup jobs yet.')).toBeVisible()
  })

  test('detail: create a SQLite job (file picker + date suffix)', async () => {
    await page.getByRole('button', { name: 'Add Job' }).click()
    await page.getByLabel('Name', { exact: true }).fill('App DB')
    await page.getByLabel('Type').selectOption('sqlite')
    await expect(page.getByTestId('type-info')).toContainText('SQLite Online Backup API')
    await page.getByRole('button', { name: 'Create' }).click()

    // Edit page: SQLite branch — file picker (lazy tree from /backups) + date toggle.
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+\/edit$/)
    await expect(page.getByTestId('job-edit')).toBeVisible()
    await page.getByRole('button', { name: 'app.db', exact: true }).click()
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

  test('alerts: muting a job surfaces the topbar badge and the Alerts page', async () => {
    // Only the App DB job exists here, so the Mute control is unambiguous.
    await page.getByRole('button', { name: 'Mute job' }).click()
    await expect(page.getByTestId('mute-indicator')).toBeVisible()
    await expect(page.getByTestId('mute-count')).toHaveText('1')

    // The indicator links to the Alerts page, which lists the muted job.
    await page.getByTestId('mute-indicator').click()
    await expect(page).toHaveURL(/\/app\/alerts$/)
    await expect(page.getByTestId('muted-row')).toContainText('App DB')
    await expect(page.getByTestId('muted-row')).toContainText('My Nextcloud')

    // Unmute → list empties and the badge disappears.
    await page.getByTestId('muted-row').getByRole('button', { name: 'Unmute' }).click()
    await expect(page.getByText('No jobs are muted.')).toBeVisible()
    await expect(page.getByTestId('mute-indicator')).toHaveCount(0)
  })

  test('alerts: Telegram settings persist and Test validates credentials', async () => {
    // Continuing on /app/alerts. Test with no credentials → inline error, no
    // external call.
    await expect(page.getByTestId('alerts-section')).toBeVisible()
    await page.getByTestId('test-telegram').click()
    await expect(page.getByTestId('test-result')).toContainText('required')

    // The channel on/off switch and chat id persist across a reload.
    await page.getByLabel('Chat ID').fill('99887766')
    await page.getByLabel('Enable Telegram alerts').check()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('✓ Saved.')).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('Chat ID')).toHaveValue('99887766')
    await expect(page.getByLabel('Enable Telegram alerts')).toBeChecked()
  })

  test('settings: server name persists', async () => {
    await page.locator('.nav-bottom').getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/\/app\/settings$/)
    await page.getByLabel('Server name').fill('prod-1')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('✓ Saved.')).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('Server name')).toHaveValue('prod-1')
    // With a server name set, the tab title gains the {server name} segment.
    await expect(page).toHaveTitle('SrvKit | prod-1 | Settings')

    // Back to the target detail page for the following tests.
    await page.locator('.subnav').getByRole('link', { name: 'My Nextcloud' }).click()
    await expect(page.getByTestId('target-page')).toBeVisible()
  })

  test('detail: saving a SQLite job rejects a non-database file', async () => {
    await page.getByRole('button', { name: 'Add Job' }).click()
    await page.getByLabel('Name', { exact: true }).fill('Bad DB')
    await page.getByLabel('Type').selectOption('sqlite')
    await page.getByRole('button', { name: 'Create' }).click()

    // On the edit page, browse into home/ and pick a non-db file, then save.
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+\/edit$/)
    await page.getByRole('button', { name: 'home', exact: true }).click()
    await page.getByRole('button', { name: 'notes.txt', exact: true }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('not a valid SQLite database')).toBeVisible()
  })

  test('detail: PostgreSQL job — Docker-not-mounted notice + validation', async () => {
    await page.locator('.subnav').getByRole('link', { name: 'My Nextcloud' }).click()
    await expect(page.getByTestId('target-page')).toBeVisible()

    await page.getByRole('button', { name: 'Add Job' }).click()
    await page.getByLabel('Name', { exact: true }).fill('PG job')
    await page.getByLabel('Type').selectOption('postgres')
    // No Docker socket in e2e → the modal warns.
    await expect(page.getByTestId('type-info')).toContainText('Docker socket not mounted')
    await page.getByRole('button', { name: 'Create' }).click()

    // Edit page: postgres fields + the same not-mounted warning.
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+\/edit$/)
    await expect(page.getByTestId('docker-warning')).toBeVisible()
    await page.getByLabel('Database').fill('appdb')
    await page.getByLabel('User').fill('postgres')
    await page.getByLabel('Schedule (cron)').fill('0 3 * * *')

    // No container is available, so saving is rejected.
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Select a container.')).toBeVisible()
  })

  test('detail: a WAL SQLite database locks the trigger to Cron', async () => {
    await page.locator('.subnav').getByRole('link', { name: 'My Nextcloud' }).click()
    await expect(page.getByTestId('target-page')).toBeVisible()

    await page.getByRole('button', { name: 'Add Job' }).click()
    await page.getByLabel('Name', { exact: true }).fill('WAL db')
    await page.getByLabel('Type').selectOption('sqlite')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+\/edit$/)

    // Default trigger is Filewatcher until a WAL database is selected.
    await expect(page.getByTestId('trigger')).toHaveValue('filewatcher')
    await page.getByRole('button', { name: 'wal.db', exact: true }).click()

    // WAL detected → trigger forced to Cron, Filewatcher disabled, notice shown.
    await expect(page.getByTestId('wal-notice')).toBeVisible()
    await expect(page.getByTestId('trigger')).toHaveValue('cron')
    await expect(
      page.getByTestId('trigger').locator('option[value="filewatcher"]'),
    ).toHaveJSProperty('disabled', true)

    // The cron schedule field appears; filling it lets the job save + activate.
    await page.getByLabel('Schedule (cron)').fill('0 3 * * *')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page).toHaveURL(/\/app\/backups\/[0-9a-f-]+$/)
    await expect(page.getByText('WAL db', { exact: true })).toBeVisible()
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

  test('dashboard: all clear when no incidents are open', async () => {
    await page.goto('/app/dashboard')
    await expect(page.getByTestId('all-clear')).toContainText('All systems OK')
    await expect(page.getByTestId('incidents')).toHaveCount(0)
  })
})
