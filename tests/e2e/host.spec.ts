import { test, expect, type Page } from '@playwright/test'

// Host monitoring toggles. The e2e fixture leaves the optional host root
// unmounted, so the Disk section is only a mount hint — the CPU/Memory metrics
// carry the switches under test.
const PASSWORD = 'correct horse battery staple e2e'
const METRIC = 'ram_usage'

test.describe.serial('host monitoring', () => {
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

  const row = () => page.getByTestId(`metric-${METRIC}`)
  const box = () => row().getByRole('checkbox')

  test('disabling a metric sticks across a reload', async () => {
    await page.goto('/app/host')
    await expect(row()).toBeVisible()
    await expect(box()).toBeChecked()

    await page.getByTestId(`toggle-${METRIC}`).click()
    await expect(box()).not.toBeChecked()
    await expect(page.getByTestId(`status-${METRIC}`)).toHaveText(/disabled/)

    await page.reload()
    await expect(box()).not.toBeChecked()

    // Back on, so the rest of the suite sees the default state.
    await page.getByTestId(`toggle-${METRIC}`).click()
    await expect(box()).toBeChecked()
  })

  test('a poll already in flight when you toggle cannot undo the save', async () => {
    // The shell and the page each poll /api/host/metrics; hold every request
    // after the first so one is still in flight when the switch is flipped.
    // Its response predates the save and still says "enabled" — it must not win.
    let n = 0
    let release: () => void
    const held = new Promise<void>((r) => (release = r))
    await page.route('**/api/host/metrics', async (route) => {
      if (++n === 1) return route.continue()
      const res = await route.fetch() // answered now — the body predates the save
      await held
      await route.fulfill({ response: res })
    })

    await page.goto('/app/host')
    await expect(row()).toBeVisible()
    await expect(box()).toBeChecked()

    await page.getByTestId(`toggle-${METRIC}`).click()
    await expect(box()).not.toBeChecked()

    release!()
    await page.waitForTimeout(500)
    await expect(box()).not.toBeChecked()

    await page.unroute('**/api/host/metrics')
    await page.getByTestId(`toggle-${METRIC}`).click()
    await expect(box()).toBeChecked()
  })

  test('a failed save rolls the switch back and says why', async () => {
    await page.goto('/app/host')
    await expect(box()).toBeChecked()

    await page.route(`**/api/host/metrics/${METRIC}`, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"nope"}' }),
    )
    await page.getByTestId(`toggle-${METRIC}`).click()

    await expect(page.getByTestId('save-error')).toBeVisible()
    await expect(box()).toBeChecked() // rolled back, not left lying about the state
    await page.unroute(`**/api/host/metrics/${METRIC}`)

    // Recovers on the next successful save.
    await page.getByTestId(`toggle-${METRIC}`).click()
    await expect(box()).not.toBeChecked()
    await expect(page.getByTestId('save-error')).toHaveCount(0)
    await page.getByTestId(`toggle-${METRIC}`).click()
  })
})
