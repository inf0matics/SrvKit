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

  test('deletes the target', async () => {
    page.once('dialog', (d) => d.accept())
    await page.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('Renamed NC')).toHaveCount(0)
    await expect(page.getByText('No targets yet.')).toBeVisible()
  })
})
