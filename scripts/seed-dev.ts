/**
 * Rebuild the local dev database and its backup destinations from scratch, so
 * `npm run dev:local` always starts from the same known state.
 *
 * Dev-only: it wipes DATABASE_PATH and BACKUP_TARGETS_DIR without asking, and
 * sets a fixed throwaway password. Never point it at anything real.
 *
 *   node --env-file=.env scripts/seed-dev.ts
 */
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { openStore, type JobInput } from '../lib/store.ts'
import { hashPassword } from '../lib/password.ts'
import { encrypt } from '../lib/crypto.ts'

const PASSWORD = 'dev'
const dbPath = process.env.DATABASE_PATH || './.data/dev.db'
const targetsDir = process.env.BACKUP_TARGETS_DIR || './.data/dev-targets'

/** Days ago, as the ISO date the archive filenames use. */
const daysAgo = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d
}
const isoDate = (d: Date) => d.toISOString().slice(0, 10)

// --- 1. Wipe -----------------------------------------------------------------
for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
rmSync(targetsDir, { recursive: true, force: true })
mkdirSync(dirname(resolve(dbPath)), { recursive: true })

// --- 2. Destinations on disk -------------------------------------------------
// The browser needs folders to walk into, and the mount must exist or the app
// refuses to write to it (which is the point of that check).
for (const dir of ['nas', 'nas/db', 'nas/configs', 'nas/home', 'nas/nightly', 'archive']) {
  mkdirSync(join(targetsDir, dir), { recursive: true })
}

// A backlog of older archives, so "Keep the newest 3" has something to trim on
// the very first Run Now instead of needing three days of patience.
for (let i = 1; i <= 6; i++) {
  writeFileSync(
    join(targetsDir, 'nas/db', `App DB_${isoDate(daysAgo(i))}.tar.gz`),
    `pretend archive from ${i} day(s) ago\n`.repeat(40),
  )
}
// A neighbour that retention must never touch: different job, same folder.
writeFileSync(join(targetsDir, 'nas/db', 'Other job_2026-01-01.tar.gz'), 'not mine\n')

// --- 3. Database -------------------------------------------------------------
const store = openStore(dbPath)
store.setPassword(hashPassword(PASSWORD))
store.setConfig('server_name', 'dev-box')

const local = store.createTarget({
  name: 'Lokale Platte',
  type: 'local',
  host: '',
  username: '',
  password: '',
  rootDir: 'nas',
})

const nextcloud = store.createTarget({
  name: 'Nextcloud (offline)',
  type: 'nextcloud',
  host: 'http://127.0.0.1:1',
  username: 'alice',
  password: encrypt('s3cret'),
  rootDir: 'srvkit',
})

const base: Omit<JobInput, 'targetId' | 'name' | 'type' | 'sourcePath'> = {
  includes: [],
  output: 'single',
  subdirectory: '',
  dateSuffix: false,
  timeSuffix: false,
  keepVersions: 0,
  trigger: 'filewatcher',
  container: '',
  database: '',
  dbUser: '',
  dbPassword: '',
  schedule: '',
}

function job(input: JobInput, opts: { active?: boolean } = {}) {
  const created = store.createJob(input)
  if (opts.active !== false) store.setJobActive(created.id, true)
  return created
}

// Overwrite — one static file, replaced every run.
const configs = job({
  ...base,
  targetId: local.id,
  name: 'Root configs',
  type: 'files',
  sourcePath: 'root',
  includes: ['.bashrc', 'configs'],
  subdirectory: 'configs',
})
store.recordRun(configs.id, {
  at: daysAgo(0).toISOString(),
  status: 'success',
  error: null,
  bytes: 4096,
})

// Keep the newest 3 — the backlog above is what it trims.
const appDb = job({
  ...base,
  targetId: local.id,
  name: 'App DB',
  type: 'sqlite',
  sourcePath: 'app.db',
  subdirectory: 'db',
  dateSuffix: true,
  timeSuffix: true,
  keepVersions: 3,
  trigger: 'cron',
  schedule: '0 3 * * *',
})
store.recordRun(appDb.id, {
  at: daysAgo(1).toISOString(),
  status: 'success',
  error: null,
  bytes: 20480,
})

// Keep all versions — a dated file per run, nothing ever deleted.
const home = job({
  ...base,
  targetId: local.id,
  name: 'Home notes',
  type: 'files',
  sourcePath: 'home',
  includes: ['notes.txt'],
  subdirectory: 'home',
  dateSuffix: true,
})
store.recordRun(home.id, {
  at: daysAgo(0).toISOString(),
  status: 'success',
  error: null,
  bytes: 128,
})

// A job whose backup is fine but whose cleanup is stuck — the run stays green,
// and the row carries the reason.
const stuck = job({
  ...base,
  targetId: local.id,
  name: 'Nightly files',
  type: 'files',
  sourcePath: 'root',
  includes: ['.bashrc'],
  subdirectory: 'nightly',
  dateSuffix: true,
  keepVersions: 2,
})
store.recordRun(stuck.id, {
  at: daysAgo(0).toISOString(),
  status: 'success',
  error: null,
  bytes: 512,
})
store.setJobCleanupError(stuck.id, 'Permission denied')

// A failing job on an unreachable share — opens an incident on the dashboard.
const failing = job({
  ...base,
  targetId: nextcloud.id,
  name: 'Etc backup',
  type: 'files',
  sourcePath: 'root',
  includes: ['configs'],
  subdirectory: 'etc',
  dateSuffix: true,
})
store.recordRun(failing.id, {
  at: daysAgo(0).toISOString(),
  status: 'failed',
  error: 'Upload failed: connect ECONNREFUSED 127.0.0.1:1',
  bytes: 2048,
})
store.setJobAlertState(failing.id, 'failed')
store.setIncidentSince(failing.id, daysAgo(2).toISOString())

// An unconfigured job, to show the "Not configured" state.
job(
  {
    ...base,
    targetId: local.id,
    name: 'Neuer Job',
    type: 'files',
    sourcePath: '',
  },
  { active: false },
)

store.close()

console.log(`✓ seeded ${dbPath}`)
console.log(`✓ destinations in ${targetsDir}`)
console.log(`  password: ${PASSWORD}`)
