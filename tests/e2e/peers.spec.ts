import { test, expect, type Page } from '@playwright/test'

// Heartbeat timing is the one peer surface that needs no second instance: the
// card writes the same config the watchdog reads, so a round-trip through the
// API proves the setting survives a reload.
const PASSWORD = 'correct horse battery staple e2e'

test.describe.serial('peers', () => {
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

  test('heartbeat timing shows the shipped defaults', async () => {
    await page.getByRole('link', { name: 'Peers', exact: true }).click()
    await expect(page).toHaveURL(/\/app\/peers$/)
    await expect(page.getByTestId('timing')).toBeVisible()
    // v1's cadence, and two missed heartbeats before anyone is paged.
    await expect(page.getByTestId('hb-interval')).toHaveValue('300')
    await expect(page.getByTestId('hb-threshold')).toHaveValue('2')
    await expect(page.getByTestId('hb-summary')).toContainText('2 missed heartbeats')
    await expect(page.getByTestId('hb-summary')).toContainText('about 11 min')
  })

  test('a changed interval and threshold survive a reload', async () => {
    await page.getByTestId('hb-interval').selectOption('60')
    await page.getByTestId('hb-threshold').fill('3')
    await page.getByTestId('hb-threshold').press('Enter')
    await expect(page.getByTestId('hb-summary')).toContainText('about 4 min')

    await page.reload()
    await expect(page.getByTestId('hb-interval')).toHaveValue('60')
    await expect(page.getByTestId('hb-threshold')).toHaveValue('3')
  })

  test('a threshold out of range is clamped, not refused', async () => {
    await page.getByTestId('hb-threshold').fill('99')
    await page.getByTestId('hb-threshold').press('Enter')
    await expect(page.getByTestId('hb-threshold')).toHaveValue('10')
    await page.reload()
    await expect(page.getByTestId('hb-threshold')).toHaveValue('10')
  })

  test('back to the defaults so later specs see a stock install', async () => {
    await page.getByTestId('hb-interval').selectOption('300')
    await page.getByTestId('hb-threshold').fill('2')
    await page.getByTestId('hb-threshold').press('Enter')
    await expect(page.getByTestId('hb-summary')).toContainText('about 11 min')
  })
})
