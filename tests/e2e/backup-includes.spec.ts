import { test, expect, type Page, type APIResponse } from '@playwright/test'

// A Files job stores an explicit list of selected paths. If a selected file is
// renamed/deleted on disk it vanishes from the picker tree, stranding a stale
// include that fails every run. The edit page must surface those orphans with a
// deselect. We can't create a stale include through the picker (it only offers
// real files), so we seed one via the API, then drive the UI fix.
//
// Runs before backups.spec (alphabetical) and deletes everything it creates, so
// backups.spec still sees the empty-targets state.
const PASSWORD = 'correct horse battery staple e2e'

test.describe.serial('backup stale includes', () => {
  let page: Page
  let targetId = ''
  let jobId = ''

  const ok = async (r: APIResponse) => {
    expect(r.ok(), `${r.url()} → ${r.status()}`).toBeTruthy()
    return r.json()
  }

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

    // Seed a target + a Files job whose selection includes a ghost file.
    const target = await ok(
      await page.request.post('/api/backups/targets', {
        data: { name: 'Stale IncTest', host: 'http://127.0.0.1:1', username: 'u', password: 'p' },
      }),
    )
    targetId = target.id
    const job = await ok(
      await page.request.post('/api/backups/jobs', {
        data: { targetId, name: 'stale-job', type: 'files' },
      }),
    )
    jobId = job.id
    await ok(
      await page.request.put(`/api/backups/jobs/${jobId}`, {
        data: {
          targetId,
          name: 'stale-job',
          type: 'files',
          sourcePath: 'root',
          includes: ['.bashrc', 'nocodb/docker-compose.yml'], // one real, one ghost
          output: 'single',
          subdirectory: 'root',
          dateSuffix: false,
          timeSuffix: false,
          trigger: 'filewatcher',
          container: '',
          database: '',
          dbUser: '',
          dbPassword: '',
          schedule: '',
        },
      }),
    )
  })

  test.afterAll(async () => {
    if (jobId) await page.request.delete(`/api/backups/jobs/${jobId}`)
    if (targetId) await page.request.delete(`/api/backups/targets/${targetId}`)
    await page.close()
  })

  test('the edit page surfaces the stale include with a deselect', async () => {
    await page.goto(`/app/backups/${targetId}/jobs/${jobId}/edit`)
    const orphans = page.getByTestId('missing-includes')
    await expect(orphans).toBeVisible()
    // Only the ghost is listed — the real `.bashrc` stays in the tree, not here.
    await expect(page.getByTestId('missing-row')).toHaveCount(1)
    await expect(orphans).toContainText('nocodb/docker-compose.yml')
  })

  test('deselecting it and saving clears the orphan for good', async () => {
    await page.getByRole('button', { name: 'Deselect nocodb/docker-compose.yml' }).click()
    await expect(page.getByTestId('missing-includes')).toHaveCount(0)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page).toHaveURL(new RegExp(`/app/backups/${targetId}$`))

    // Reopen: the orphan is gone from the stored selection.
    await page.goto(`/app/backups/${targetId}/jobs/${jobId}/edit`)
    await expect(page.getByTestId('job-edit')).toBeVisible()
    await expect(page.getByTestId('missing-includes')).toHaveCount(0)
    // The still-present file remains selected.
    await expect(page.getByRole('checkbox', { name: '.bashrc' })).toBeChecked()
  })
})
