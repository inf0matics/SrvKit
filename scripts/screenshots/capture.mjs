// Logs into the seeded screenshot server and captures README screenshots.
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'

const PORT = process.env.SHOT_PORT || '3200'
const PASS = process.env.SHOT_PASS || 'screenshot-demo-pass'
const BASE = `http://localhost:${PORT}`
const OUT = 'docs/screenshots'
const ids = JSON.parse(readFileSync('scripts/screenshots/seed-ids.json', 'utf8'))

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })

// --- Login ---
await page.goto(`${BASE}/`)
await page.getByPlaceholder('Passphrase').fill(PASS)
await page.getByRole('button', { name: 'Login', exact: true }).click()
await page.waitForURL(/\/app\/dashboard$/)

async function shot(name, { settle = 600 } = {}) {
  await page.waitForTimeout(settle)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('captured', name)
}

// Dashboard
await shot('dashboard')

// Host monitoring (let a poll populate)
await page.goto(`${BASE}/app/host`)
await shot('host-monitoring', { settle: 1200 })

// Docker monitoring
await page.goto(`${BASE}/app/docker`)
await shot('docker-monitoring', { settle: 1200 })

// Ping monitoring (boot poll populates OK/CRIT from the seeded external URLs)
await page.goto(`${BASE}/app/pings`)
await shot('ping-monitoring', { settle: 1500 })

// Backups — target detail with the job list
await page.goto(`${BASE}/app/backups/${ids.targetId}`)
await shot('backup-jobs')

// Backup job edit pages
await page.goto(`${BASE}/app/backups/${ids.targetId}/jobs/${ids.filesJobId}/edit`)
await shot('backup-job-filewatcher')
await page.goto(`${BASE}/app/backups/${ids.targetId}/jobs/${ids.pgJobId}/edit`)
await shot('backup-job-postgresql')

// Peers
await page.goto(`${BASE}/app/peers`)
await shot('peer-heartbeat', { settle: 1000 })

// Alerts (Telegram)
await page.goto(`${BASE}/app/alerts`)
await shot('alerting-telegram')

await browser.close()
console.log('done')
