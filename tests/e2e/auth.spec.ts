import { test, expect } from '@playwright/test'

// One server / one DB shared across these tests (booted in setup mode), so the
// order matters: setup happens once, then everything else assumes initialized.
// The brute-force / rate-limit test lives in its own spec so these login flows
// never trip the per-IP limit.
test.describe.configure({ mode: 'serial' })

const PASSWORD = 'correct horse battery staple e2e'

/** Every distinct `data-theme` seen over ~400ms, in the order it appeared. */
async function themesOver(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(async () => {
    const themes: string[] = []
    for (let i = 0; i < 8; i++) {
      themes.push(document.documentElement.dataset.theme ?? '')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return [...new Set(themes)]
  })
}

/**
 * Assert the theme ends on `want` and then holds it. A retrying assertion
 * passes on the first match, so it would accept a value that flips back a
 * moment later; sampling twice pins the end state and its stability.
 *
 * It tolerates whatever precedes `want`, which is right for an in-page
 * transition: entering the shell from the always-dark landing can show the
 * previous theme for a frame before the layout mounts. A full document load
 * may not — the server knows the stored choice, so assert on `themesOver`
 * directly there.
 */
async function expectThemeSettlesOn(page: import('@playwright/test').Page, want: string) {
  expect((await themesOver(page)).at(-1), 'theme should settle on ' + want).toBe(want)
  expect(await themesOver(page), 'theme should then hold ' + want).toEqual([want])
}

// The e2e port is per-run, so derive the origin rather than hardcoding it.
const PORT = process.env.E2E_RESOLVED_PORT
if (!PORT) throw new Error('E2E_RESOLVED_PORT is unset — run via playwright.config.ts')

/** Seed the stored theme the way the app stores it: a cookie the server reads. */
async function storeTheme(page: import('@playwright/test').Page, value: 'dark' | 'light') {
  await page.context().addCookies([
    { name: 'srvkit-theme', value, url: `http://localhost:${PORT}` },
  ])
}

async function login(page: import('@playwright/test').Page) {
  await page.getByPlaceholder('Passphrase').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/dashboard$/)
}

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

test('unauthenticated access to a target page redirects', async ({ page }) => {
  await page.goto('/app/backups/some-target-id')
  await expect(page).toHaveURL(/\/$/)
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
  // A full load must be light from the first sample: the server read the
  // cookie, so there is no dark frame to tolerate here.
  expect(await themesOver(page)).toEqual(['light'])

  // Tip Jar hidden when TIP_JAR_URL is unset (the e2e default).
  await expect(page.getByRole('link', { name: 'Tip Jar' })).toHaveCount(0)

  // GitHub link + version badge share one row; the badge links to the release.
  await expect(page.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
    'href',
    /github\.com/,
  )
  await expect(page.getByTestId('sidebar-version')).toHaveText(/^v\d+\.\d+\.\d+$/)
  await expect(page.locator('a.ver-badge')).toHaveAttribute(
    'href',
    /\/releases\/tag\/v\d+\.\d+\.\d+$/,
  )

  // Leaving the shell returns to dark even with light still stored: the landing
  // is always-dark, and only the shell may override the default.
  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expectThemeSettlesOn(page, 'dark')
})

test('landing stays dark on a cold load with light stored', async ({ page }) => {
  // A returning signed-out visitor still carries their shell theme in
  // localStorage. The landing is always-dark, so a cold load must ignore it —
  // the SPA logout path above covers the same invariant only on an unmount.
  await storeTheme(page, 'light')
  await page.goto('/')
  await expect(page.getByPlaceholder('Passphrase')).toBeVisible()
  // Guard the precondition: without the seeded value this test proves nothing.
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'srvkit-theme')?.value).toBe('light')

  expect(await themesOver(page)).toEqual(['dark'])
})

test('the shell re-applies the stored theme when it remounts without a reload', async ({
  page,
}) => {
  // Logout -> login in one page session remounts the shell without a new
  // document, so the layout must re-run its mount hook, re-read localStorage
  // and push a fresh head entry that again outranks the global dark default.
  // Nothing covered that: the reload case gets a fresh document, and the
  // logout case only checks the unmount. Going back through history does not
  // reach it either — /app redirects straight back into the shell.
  await storeTheme(page, 'light')
  await page.goto('/')
  await login(page)
  await expectThemeSettlesOn(page, 'light')

  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expectThemeSettlesOn(page, 'dark')

  // The second mount is the one at risk — no reload, so no fresh head state.
  await login(page)
  await expectThemeSettlesOn(page, 'light')
})

test('a stored light theme is applied before the first paint', async ({ page }) => {
  // SSR cannot know the stored choice, so the first HTML always carries the
  // dark default. What must not happen is a painted dark frame: the choice has
  // to land while the head is still being parsed. The first requestAnimationFrame
  // callback runs before the first paint, so the value there is what the user
  // would actually see.
  await page.addInitScript(() => {
    const w = window as unknown as { __themeAtFirstFrame?: string }
    requestAnimationFrame(() => {
      w.__themeAtFirstFrame = document.documentElement.dataset.theme ?? ''
    })
  })
  await storeTheme(page, 'light')

  await page.goto('/')
  await login(page)
  await expectThemeSettlesOn(page, 'light')

  // Reload so the measurement covers a full document load of a shell route,
  // which is where the flash was visible.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Dark mode' })).toBeVisible()

  const atFirstFrame = await page.evaluate(
    () => (window as unknown as { __themeAtFirstFrame?: string }).__themeAtFirstFrame,
  )
  expect(atFirstFrame, 'no dark frame may be painted for a stored light theme').toBe('light')
})

test('sidebar bottom nav stays pinned when the content scrolls', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('Passphrase').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/dashboard$/)

  // A short viewport + the long Host page guarantees the content overflows.
  await page.setViewportSize({ width: 1280, height: 500 })
  await page.goto('/app/host')
  await expect(page.getByTestId('host')).toBeVisible()

  const settings = page.locator('.nav-bottom').getByRole('link', { name: 'Settings' })
  await expect(settings).toBeInViewport()

  // Scroll the content to the very bottom — the pinned sidebar keeps it in view.
  // Scroll inside the retry: the host page grows as its metrics arrive, and a
  // single scroll issued before it finished can never reach the bottom.
  await expect(async () => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(50)
  }).toPass()
  await expect(settings).toBeInViewport()
})

test('"Can\'t login?" modal shows the CLI reset command', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: "Can't login?" }).click()
  const dialog = page.getByRole('dialog', { name: "Can't login?" })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('srvkit change-password')
})
