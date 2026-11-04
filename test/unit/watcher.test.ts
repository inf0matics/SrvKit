import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// Configure the environment before importing modules that read it.
const base = mkdtempSync(join(tmpdir(), 'srvkit-watcher-'))
process.env.DATABASE_PATH = join(base, 'db.sqlite')
process.env.ENCRYPTION_KEY = 'watcher-test-key'
process.env.BACKUP_SOURCES_DIR = join(base, 'sources')
process.env.BACKUP_TARGETS_DIR = join(base, 'targets')

const { store } = await import('../../server/utils/srvkit.ts')
const { encryptPassword } = await import('../../server/utils/backups.ts')
const { registerJob, unregisterJob, debounceRemainingMs, jobState } = await import(
  '../../server/utils/watcher.ts'
)

type JobOverrides = Partial<Parameters<ReturnType<typeof store>['createJob']>[0]>

let targetId = ''

/** An active, enabled job, read back so `active` reflects the update. */
function makeJob(overrides: JobOverrides) {
  const id = store().createJob({
    targetId,
    name: 'Job',
    type: 'files',
    sourcePath: 'root',
    includes: ['configs'],
    output: 'single',
    subdirectory: 'sub',
    dateSuffix: false,
    timeSuffix: false,
    keepVersions: 0,
    trigger: 'filewatcher',
    container: '',
    database: '',
    dbUser: '',
    dbPassword: '',
    schedule: '',
    ...overrides,
  }).id
  store().setJobActive(id, true)
  return store().getJob(id)!
}

/**
 * Poll until `check` passes, re-running `poke` each round. chokidar's watcher is
 * not ready the instant registerJob returns and `ignoreInitial` drops anything
 * it sees while starting, so a single write can legitimately be missed — poking
 * repeatedly is what makes this deterministic rather than timing-dependent.
 */
async function waitFor(poke: () => void, check: () => boolean, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    poke()
    if (check()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

before(() => {
  mkdirSync(join(base, 'sources', 'root', 'configs'), { recursive: true })
  const sdb = new DatabaseSync(join(base, 'sources', 'data.db'))
  sdb.exec('CREATE TABLE t(a)')
  sdb.close()

  targetId = store().createTarget({
    name: 'T',
    host: 'https://nc.example.com',
    username: 'alice',
    password: encryptPassword('secret'),
    rootDir: 'srvkit',
  }).id
})

after(() => {
  store().close()
  rmSync(base, { recursive: true, force: true })
})

test('a files job starts debouncing when a watched directory changes', async () => {
  const job = makeJob({ includes: ['configs'] })
  registerJob(job)
  try {
    assert.equal(debounceRemainingMs(job.id), 0, 'should not debounce before any change')
    assert.equal(jobState(job).state, 'never')

    let n = 0
    const fired = await waitFor(
      () => writeFileSync(join(base, 'sources', 'root', 'configs', `f${n++}.txt`), 'x'),
      () => debounceRemainingMs(job.id) > 0,
    )
    assert.ok(fired, 'a write inside the watched directory should start the debounce')

    const live = jobState(job)
    assert.equal(live.state, 'debouncing')
    assert.ok(live.remainingMs > 0 && live.remainingMs <= 10_000, `got ${live.remainingMs}ms`)
  } finally {
    // Also clears the pending timer, so no backup fires into the rest of the run.
    unregisterJob(job.id)
  }
  assert.equal(debounceRemainingMs(job.id), 0, 'unregister should clear the debounce')
})

test('a filewatcher sqlite job watches the source file itself', async () => {
  // The other path shape watcher.ts builds: the .db file, not a directory.
  const job = makeJob({ type: 'sqlite', sourcePath: 'data.db', includes: [] })
  registerJob(job)
  try {
    const fired = await waitFor(
      () => writeFileSync(join(base, 'sources', 'data.db'), `touched ${Date.now()}`),
      () => debounceRemainingMs(job.id) > 0,
    )
    assert.ok(fired, 'a change to the watched .db file should start the debounce')
  } finally {
    unregisterJob(job.id)
  }
})

test('schedule-driven jobs are left to the scheduler, not watched', async () => {
  // postgres/mysql always, and sqlite when its trigger is cron. Registering
  // these must be a no-op, or they would back up twice.
  const cases: JobOverrides[] = [
    { type: 'postgres', container: 'db', database: 'app' },
    { type: 'mysql', container: 'db', database: 'app' },
    { type: 'sqlite', sourcePath: 'data.db', includes: [], trigger: 'cron', schedule: '0 3 * * *' },
  ]

  for (const overrides of cases) {
    const job = makeJob(overrides)
    registerJob(job)
    try {
      const started = await waitFor(
        () => writeFileSync(join(base, 'sources', 'data.db'), `touched ${Date.now()}`),
        () => debounceRemainingMs(job.id) > 0,
        1000,
      )
      assert.equal(started, false, `${job.type}/${job.trigger} should not be watched`)
    } finally {
      unregisterJob(job.id)
    }
  }
})

test('an inactive or disabled job is not watched', async () => {
  const job = makeJob({ includes: ['configs'] })
  store().setJobEnabled(job.id, false)
  registerJob({ ...job, enabled: false })
  try {
    let n = 0
    const started = await waitFor(
      () => writeFileSync(join(base, 'sources', 'root', 'configs', `d${n++}.txt`), 'x'),
      () => debounceRemainingMs(job.id) > 0,
      1000,
    )
    assert.equal(started, false, 'a disabled job should not be watched')
  } finally {
    unregisterJob(job.id)
  }
})
