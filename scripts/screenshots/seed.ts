// Seeds a throwaway DB with representative data for README screenshots.
// Run with the same ENCRYPTION_KEY / DATABASE_PATH the screenshot server uses.
import { writeFileSync } from 'node:fs'
import { openStore } from '../../lib/store.ts'
import { encrypt } from '../../lib/crypto.ts'
import { hashPassword } from '../../lib/password.ts'

const DB = process.env.DATABASE_PATH!
const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString()

const s = openStore(DB)

// --- Auth ---
s.setPassword(hashPassword(process.env.SHOT_PASS || 'screenshot-demo-pass'))

// --- Server name + Telegram alerting ---
s.setConfig('server_name', 'web-1')
s.setConfig('alerts_tg_token', encrypt('7654321:AAH-demo-bot-token-not-real'))
s.setConfig('alerts_tg_chat', '123456789')
s.setConfig('alerts_tg_enabled', '1')
s.setConfig('alerts_recovery', '1')
s.setConfig('alerts_nctalk_url', 'https://cloud.example.com')
s.setConfig('alerts_nctalk_bot', encrypt('demo-nctalk-bot-secret'))
s.setConfig('alerts_nctalk_conv', 'tlk9k2x7')
s.setConfig('alerts_nctalk_enabled', '1')

// --- Backup target + jobs ---
const target = s.createTarget({
  name: 'My Nextcloud',
  host: 'https://nextcloud.example.com',
  username: 'backup',
  password: encrypt('s3cret-app-password'),
  rootDir: 'srvkit',
})

const filesJob = s.createJob({
  targetId: target.id,
  name: 'Config files',
  type: 'files',
  sourcePath: 'root',
  includes: ['configs', '.bashrc'],
  output: 'single',
  subdirectory: 'configs',
  dateSuffix: true,
  timeSuffix: false,
  trigger: 'filewatcher',
  container: '',
  database: '',
  dbUser: '',
  dbPassword: '',
  schedule: '',
})
s.setJobActive(filesJob.id, true)
s.recordRun(filesJob.id, { at: ago(42), status: 'success', error: null })

const pgJob = s.createJob({
  targetId: target.id,
  name: 'App database',
  type: 'postgres',
  sourcePath: '',
  includes: [],
  output: 'single',
  subdirectory: 'database',
  dateSuffix: true,
  timeSuffix: false,
  trigger: 'cron',
  container: 'postgres',
  database: 'appdb',
  dbUser: 'postgres',
  dbPassword: encrypt('pg-pass'),
  schedule: '0 3 * * *',
})
s.setJobActive(pgJob.id, true)
s.recordRun(pgJob.id, { at: ago(180), status: 'success', error: null })

const sqliteJob = s.createJob({
  targetId: target.id,
  name: 'Metrics SQLite',
  type: 'sqlite',
  sourcePath: 'data/metrics.db',
  includes: [],
  output: 'single',
  subdirectory: 'sqlite',
  dateSuffix: false,
  timeSuffix: false,
  trigger: 'cron',
  container: '',
  database: '',
  dbUser: '',
  dbPassword: '',
  schedule: '0 */6 * * *',
})
s.setJobActive(sqliteJob.id, true)
// A failed run → opens an incident on the dashboard.
s.recordRun(sqliteJob.id, {
  at: ago(12),
  status: 'failed',
  error: 'Upload failed: 507 Insufficient Storage',
})
s.setJobAlertState(sqliteJob.id, 'failed')
s.setIncidentSince(sqliteJob.id, ago(12))

// --- Host monitoring: RAM → WARN, disk → CRIT immediately (1 consecutive poll) ---
s.setConfig('host_metric_cfg', JSON.stringify({ ram_usage: { polls: 1 }, disk_root: { polls: 1 } }))

// --- Docker monitoring: enable the demo containers + count summary ---
s.setConfig(
  'docker_container_cfg',
  JSON.stringify({
    postgres: { enabled: true },
    redis: { enabled: true },
    'web-app': { enabled: true },
    nginx: { enabled: true },
    'legacy-worker': { enabled: true },
  }),
)
s.setConfig('docker_count_enabled', '1')

// --- Peers: one healthy monitored peer ---
s.createPeer('edge-2', encrypt('demo-peer-token'), '203.0.113.42')

s.close()

writeFileSync(
  'scripts/screenshots/seed-ids.json',
  JSON.stringify({ targetId: target.id, filesJobId: filesJob.id, pgJobId: pgJob.id }, null, 2),
)
console.log('seeded', DB)
