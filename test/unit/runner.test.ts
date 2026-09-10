import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// Configure the environment before importing modules that read it.
const base = mkdtempSync(join(tmpdir(), 'srvkit-runner-'))
process.env.DATABASE_PATH = join(base, 'db.sqlite')
process.env.ENCRYPTION_KEY = 'runner-test-key'
process.env.BACKUP_SOURCES_DIR = join(base, 'sources')
process.env.BACKUP_TARGETS_DIR = join(base, 'targets')

const { store } = await import('../../server/utils/srvkit.ts')
const { encryptPassword } = await import('../../server/utils/backups.ts')
const { runBackup } = await import('../../server/utils/runner.ts')

let targetId = ''
let jobId = ''
const realFetch = globalThis.fetch

before(() => {
  mkdirSync(join(base, 'sources', 'root'), { recursive: true })
  writeFileSync(join(base, 'sources', 'root', 'file.txt'), 'hello')
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
  jobId = store().createJob({
    targetId,
    name: 'Job',
    type: 'files',
    sourcePath: 'root',
    includes: ['file.txt'],
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
  }).id
})

beforeEach(() => {
  globalThis.fetch = realFetch
})

after(() => {
  globalThis.fetch = realFetch
  store().close()
  rmSync(base, { recursive: true, force: true })
})

test('records success when the upload succeeds', async () => {
  const calls: { method: string; url: string }[] = []
  globalThis.fetch = (async (url: string, init: { method: string }) => {
    calls.push({ method: init.method, url: String(url) })
    return { ok: true, status: 201 } as Response
  }) as typeof fetch

  await runBackup(jobId)

  const job = store().getJob(jobId)
  assert.equal(job?.lastStatus, 'success')
  assert.equal(job?.lastError, null)
  // PUT lands at the full destination path.
  const put = calls.find((c) => c.method === 'PUT')
  assert.match(put!.url, /\/remote\.php\/dav\/files\/alice\/srvkit\/sub\/Job\.tar\.gz$/)
})

test('records failure when the upload fails', async () => {
  globalThis.fetch = (async () => ({ ok: false, status: 507 }) as Response) as typeof fetch
  await runBackup(jobId)
  const job = store().getJob(jobId)
  assert.equal(job?.lastStatus, 'failed')
  assert.match(job!.lastError!, /Upload failed/)
})

test('sqlite job backs up the db and uploads with a dated filename', async () => {
  const sqliteJobId = store().createJob({
    targetId,
    name: 'App',
    type: 'sqlite',
    sourcePath: 'data.db',
    includes: [],
    output: 'single',
    subdirectory: 'db',
    dateSuffix: true,
    timeSuffix: true,
    keepVersions: 0,
    trigger: 'filewatcher',
    container: '',
    database: '',
    dbUser: '',
    dbPassword: '',
    schedule: '',
  }).id

  const calls: { method: string; url: string }[] = []
  globalThis.fetch = (async (url: string, init: { method: string }) => {
    calls.push({ method: init.method, url: String(url) })
    return { ok: true, status: 201 } as Response
  }) as typeof fetch

  await runBackup(sqliteJobId)

  assert.equal(store().getJob(sqliteJobId)?.lastStatus, 'success')
  const put = calls.find((c) => c.method === 'PUT')
  // .../srvkit/db/App_YYYY-MM-DD_HH-MM-SS.tar.gz
  assert.match(
    put!.url,
    /\/srvkit\/db\/App_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.tar\.gz$/,
  )
})

// --- Empty content is a failure, not a green run (patch spec 09.01) ---

test('records the byte count of the content on a successful run', async () => {
  globalThis.fetch = (async () => ({ ok: true, status: 201 }) as Response) as typeof fetch
  await runBackup(jobId)
  const job = store().getJob(jobId)
  assert.equal(job?.lastStatus, 'success')
  assert.equal(job?.lastBytes, 5) // 'hello'
})

test('a files job whose sources are all empty fails and uploads nothing', async () => {
  mkdirSync(join(base, 'sources', 'empty'), { recursive: true })
  writeFileSync(join(base, 'sources', 'empty', 'nothing.txt'), '')
  const emptyJobId = store().createJob({
    targetId,
    name: 'Empty',
    type: 'files',
    sourcePath: 'empty',
    includes: ['nothing.txt'],
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
  }).id

  const calls: { method: string }[] = []
  globalThis.fetch = (async (_url: string, init: { method: string }) => {
    calls.push({ method: init.method })
    return { ok: true, status: 201 } as Response
  }) as typeof fetch

  await runBackup(emptyJobId)

  const job = store().getJob(emptyJobId)
  assert.equal(job?.lastStatus, 'failed')
  assert.equal(job?.lastError, 'Dump produced 0 bytes — nothing was backed up')
  assert.equal(job?.lastBytes, 0)
  // The substantive half: a bad run must not overwrite a good backup.
  assert.equal(
    calls.find((c) => c.method === 'PUT'),
    undefined,
  )
})

// --- Local directory targets (spec 18) ---

test('a files job writes its archive into a local target directory', async () => {
  mkdirSync(join(base, 'targets', 'nas'), { recursive: true })
  const localTargetId = store().createTarget({
    name: 'Local',
    type: 'local',
    host: '',
    username: '',
    password: '',
    rootDir: 'nas',
  }).id
  const localJobId = store().createJob({
    targetId: localTargetId,
    name: 'LocalJob',
    type: 'files',
    sourcePath: 'root',
    includes: ['file.txt'],
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
  }).id

  // A local run must not touch the network at all.
  globalThis.fetch = (async () => {
    throw new Error('a local target must not make network requests')
  }) as typeof fetch

  await runBackup(localJobId)

  const job = store().getJob(localJobId)
  assert.equal(job?.lastStatus, 'success')
  assert.equal(job?.lastError, null)
  assert.equal(job?.lastBytes, 5) // 'hello'
  // Same archive name it would have produced on Nextcloud.
  assert.deepEqual(readdirSync(join(base, 'targets', 'nas', 'sub')), ['LocalJob.tar.gz'])
})

test('a local run fails cleanly when the target directory is not writable', async () => {
  const brokenTargetId = store().createTarget({
    name: 'Broken',
    type: 'local',
    host: '',
    username: '',
    password: '',
    rootDir: '../outside',
  }).id
  const brokenJobId = store().createJob({
    targetId: brokenTargetId,
    name: 'BrokenJob',
    type: 'files',
    sourcePath: 'root',
    includes: ['file.txt'],
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
  }).id

  await runBackup(brokenJobId)

  const job = store().getJob(brokenJobId)
  assert.equal(job?.lastStatus, 'failed')
  assert.match(job!.lastError!, /Upload failed/)
})

test('a sqlite job writes a dated archive into a local target directory', async () => {
  mkdirSync(join(base, 'targets', 'nas2'), { recursive: true })
  const localTargetId = store().createTarget({
    name: 'Local2',
    type: 'local',
    host: '',
    username: '',
    password: '',
    rootDir: 'nas2',
  }).id
  const localSqliteId = store().createJob({
    targetId: localTargetId,
    name: 'LocalDB',
    type: 'sqlite',
    sourcePath: 'data.db',
    includes: [],
    output: 'single',
    subdirectory: 'db',
    dateSuffix: true,
    timeSuffix: true,
    keepVersions: 0,
    trigger: 'filewatcher',
    container: '',
    database: '',
    dbUser: '',
    dbPassword: '',
    schedule: '',
  }).id

  globalThis.fetch = (async () => {
    throw new Error('a local target must not make network requests')
  }) as typeof fetch

  await runBackup(localSqliteId)

  assert.equal(store().getJob(localSqliteId)?.lastStatus, 'success')
  // Same name it would have produced on Nextcloud: LocalDB_YYYY-MM-DD_HH-MM-SS.tar.gz
  const written = readdirSync(join(base, 'targets', 'nas2', 'db'))
  assert.equal(written.length, 1)
  assert.match(written[0]!, /^LocalDB_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.tar\.gz$/)
})

// --- Retention: keep the newest N (spec 19) ---

/** A files job writing into `<targets>/<rootDir>/<subdir>` on a local target. */
function localRetentionJob(name: string, rootDir: string, keepVersions: number) {
  mkdirSync(join(base, 'targets', rootDir), { recursive: true })
  const targetId = store().createTarget({
    name: `T-${rootDir}`,
    type: 'local',
    host: '',
    username: '',
    password: '',
    rootDir,
  }).id
  return store().createJob({
    targetId,
    name,
    type: 'files',
    sourcePath: 'root',
    includes: ['file.txt'],
    output: 'single',
    subdirectory: '',
    dateSuffix: true,
    timeSuffix: false,
    keepVersions,
    trigger: 'filewatcher',
    container: '',
    database: '',
    dbUser: '',
    dbPassword: '',
    schedule: '',
  }).id
}

/** Pre-existing archives from earlier runs. */
function seed(rootDir: string, names: string[]) {
  for (const n of names) writeFileSync(join(base, 'targets', rootDir, n), 'old')
}

test('a successful run trims the directory to the newest N archives', async () => {
  const jobId2 = localRetentionJob('Keep7', 'keep7', 3)
  seed('keep7', [
    'Keep7_2026-01-01.tar.gz',
    'Keep7_2026-01-02.tar.gz',
    'Keep7_2026-01-03.tar.gz',
    'Keep7_2026-01-04.tar.gz',
  ])

  await runBackup(jobId2)

  const job = store().getJob(jobId2)
  assert.equal(job?.lastStatus, 'success')
  const left = readdirSync(join(base, 'targets', 'keep7')).sort()
  assert.equal(left.length, 3)
  // The archive this run wrote is today's, and is always among the newest.
  const today = new Date().toISOString().slice(0, 10)
  assert.ok(left.includes(`Keep7_${today}.tar.gz`))
  // The two oldest are gone; the newest of the seeded ones survives.
  assert.ok(!left.includes('Keep7_2026-01-01.tar.gz'))
  assert.ok(!left.includes('Keep7_2026-01-02.tar.gz'))
})

test('retention leaves another job archives in the same directory alone', async () => {
  const jobId2 = localRetentionJob('Mine', 'shared', 2)
  seed('shared', [
    'Mine_2026-01-01.tar.gz',
    'Mine_2026-01-02.tar.gz',
    'Mine_2026-01-03.tar.gz',
    'Other_2026-01-01.tar.gz',
    'Mine-old_2026-01-01.tar.gz',
    'notes.txt',
  ])

  await runBackup(jobId2)

  const left = readdirSync(join(base, 'targets', 'shared')).sort()
  assert.ok(left.includes('Other_2026-01-01.tar.gz'))
  assert.ok(left.includes('Mine-old_2026-01-01.tar.gz'))
  assert.ok(left.includes('notes.txt'))
  assert.equal(left.filter((f) => /^Mine_/.test(f)).length, 2)
})

test('keepVersions 0 deletes nothing', async () => {
  const jobId2 = localRetentionJob('KeepAll', 'keepall', 0)
  seed('keepall', ['KeepAll_2026-01-01.tar.gz', 'KeepAll_2026-01-02.tar.gz'])

  await runBackup(jobId2)

  assert.equal(store().getJob(jobId2)?.lastStatus, 'success')
  const left = readdirSync(join(base, 'targets', 'keepall'))
  assert.equal(left.length, 3) // both seeded + the new one
})

test('a failed run deletes nothing', async () => {
  mkdirSync(join(base, 'sources', 'blank'), { recursive: true })
  writeFileSync(join(base, 'sources', 'blank', 'nothing.txt'), '')
  mkdirSync(join(base, 'targets', 'failrun'), { recursive: true })
  const targetId2 = store().createTarget({
    name: 'T-failrun',
    type: 'local',
    host: '',
    username: '',
    password: '',
    rootDir: 'failrun',
  }).id
  const jobId2 = store().createJob({
    targetId: targetId2,
    name: 'Doomed',
    type: 'files',
    sourcePath: 'blank',
    includes: ['nothing.txt'],
    output: 'single',
    subdirectory: '',
    dateSuffix: true,
    timeSuffix: false,
    keepVersions: 2,
    trigger: 'filewatcher',
    container: '',
    database: '',
    dbUser: '',
    dbPassword: '',
    schedule: '',
  }).id
  seed('failrun', [
    'Doomed_2026-01-01.tar.gz',
    'Doomed_2026-01-02.tar.gz',
    'Doomed_2026-01-03.tar.gz',
  ])

  await runBackup(jobId2)

  // A failed backup must never be able to delete a good one.
  assert.equal(store().getJob(jobId2)?.lastStatus, 'failed')
  assert.equal(readdirSync(join(base, 'targets', 'failrun')).length, 3)
})

test('retention on a Nextcloud target lists and deletes over WebDAV', async () => {
  const ncJobId = store().createJob({
    targetId,
    name: 'NCKeep',
    type: 'files',
    sourcePath: 'root',
    includes: ['file.txt'],
    output: 'single',
    subdirectory: 'nc',
    dateSuffix: true,
    timeSuffix: false,
    keepVersions: 2,
    trigger: 'filewatcher',
    container: '',
    database: '',
    dbUser: '',
    dbPassword: '',
    schedule: '',
  }).id

  const today = new Date().toISOString().slice(0, 10)
  const listing = `<d:multistatus xmlns:d="DAV:">
    <d:response><d:href>/remote.php/dav/files/alice/srvkit/nc/</d:href>
      <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
    ${['NCKeep_2026-01-01.tar.gz', 'NCKeep_2026-01-02.tar.gz', 'NCKeep_2026-01-03.tar.gz', `NCKeep_${today}.tar.gz`]
      .map(
        (n) => `<d:response><d:href>/remote.php/dav/files/alice/srvkit/nc/${n}</d:href>
      <d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>`,
      )
      .join('')}
  </d:multistatus>`

  const deleted: string[] = []
  globalThis.fetch = (async (url: string, init: { method: string }) => {
    if (init.method === 'PROPFIND') {
      return new Response(listing, { status: 207 })
    }
    if (init.method === 'DELETE') {
      deleted.push(decodeURIComponent(String(url).split('/').pop()!))
      return new Response(null, { status: 204 })
    }
    return new Response('', { status: 201 }) // MKCOL / PUT
  }) as unknown as typeof fetch

  await runBackup(ncJobId)

  assert.equal(store().getJob(ncJobId)?.lastStatus, 'success')
  // Keeps today's archive plus the newest seeded one; the two oldest go.
  assert.deepEqual(deleted.sort(), ['NCKeep_2026-01-01.tar.gz', 'NCKeep_2026-01-02.tar.gz'])
})

test('a cleanup failure leaves the run green and logs the reason', async () => {
  const ncJobId = store().createJob({
    targetId,
    name: 'NCBroken',
    type: 'files',
    sourcePath: 'root',
    includes: ['file.txt'],
    output: 'single',
    subdirectory: 'nc2',
    dateSuffix: true,
    timeSuffix: false,
    keepVersions: 2,
    trigger: 'filewatcher',
    container: '',
    database: '',
    dbUser: '',
    dbPassword: '',
    schedule: '',
  }).id

  // The upload succeeds; only the cleanup listing fails.
  globalThis.fetch = (async (_url: string, init: { method: string }) => {
    if (init.method === 'PROPFIND') return new Response('', { status: 500 })
    return new Response('', { status: 201 })
  }) as unknown as typeof fetch

  const logged: string[] = []
  const realError = console.error
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(' '))
  }
  try {
    await runBackup(ncJobId)
  } finally {
    console.error = realError
  }

  // The backup is safely uploaded — failing the run would alert about data
  // that is fine.
  const job = store().getJob(ncJobId)
  assert.equal(job?.lastStatus, 'success')
  assert.equal(job?.lastError, null)
  const line = logged.find((l) => l.includes('NCBroken'))
  assert.ok(line, `expected a log line naming the job, got: ${JSON.stringify(logged)}`)
  assert.match(line!, /500/)
})

// --- Review fixes: concurrency, colliding jobs, visible cleanup failures ---

test('a second run of the same job is skipped while one is in flight', async () => {
  const jobId2 = localRetentionJob('Concurrent', 'concurrent', 2)
  // Kick off two runs without awaiting the first: the second must return
  // immediately rather than racing the first through upload and retention.
  const first = runBackup(jobId2)
  const second = runBackup(jobId2)
  await Promise.all([first, second])
  const written = readdirSync(join(base, 'targets', 'concurrent'))
  assert.equal(written.length, 1, 'only one archive, written once')
  assert.equal(store().getJob(jobId2)?.lastStatus, 'success')
})

test('retention skips cleanup when another job writes the same archive names', async () => {
  mkdirSync(join(base, 'targets', 'shared2'), { recursive: true })
  const targetId2 = store().createTarget({
    name: 'T-shared2',
    type: 'local',
    host: '',
    username: '',
    password: '',
    rootDir: 'shared2',
  }).id
  const common = {
    targetId: targetId2,
    type: 'files',
    sourcePath: 'root',
    includes: ['file.txt'],
    output: 'single',
    subdirectory: '',
    dateSuffix: true,
    trigger: 'filewatcher',
    container: '',
    database: '',
    dbUser: '',
    dbPassword: '',
    schedule: '',
  }
  // Two jobs, same name, same target, same directory — one daily, one hourly.
  const daily = store().createJob({
    ...common,
    name: 'twin',
    timeSuffix: false,
    keepVersions: 2,
  }).id
  store().createJob({ ...common, name: 'twin', timeSuffix: true, keepVersions: 0 })

  seed('shared2', [
    'twin_2026-01-01.tar.gz',
    'twin_2026-01-02_03-00-00.tar.gz',
    'twin_2026-01-03_03-00-00.tar.gz',
  ])

  await runBackup(daily)

  // A job must never delete archives it cannot prove are its own.
  const left = readdirSync(join(base, 'targets', 'shared2'))
  assert.ok(left.includes('twin_2026-01-01.tar.gz'))
  assert.ok(left.includes('twin_2026-01-02_03-00-00.tar.gz'))
  assert.ok(left.includes('twin_2026-01-03_03-00-00.tar.gz'))
  const job = store().getJob(daily)
  assert.equal(job?.lastStatus, 'success')
  assert.match(job!.lastCleanupError!, /another job/i)
})

test('a cleanup failure is recorded on the job, not just logged', async () => {
  const ncJobId = store().createJob({
    targetId,
    name: 'NCVisible',
    type: 'files',
    sourcePath: 'root',
    includes: ['file.txt'],
    output: 'single',
    subdirectory: 'nc3',
    dateSuffix: true,
    timeSuffix: false,
    keepVersions: 2,
    trigger: 'filewatcher',
    container: '',
    database: '',
    dbUser: '',
    dbPassword: '',
    schedule: '',
  }).id

  globalThis.fetch = (async (_url: string, init: { method: string }) => {
    if (init.method === 'PROPFIND') return new Response('', { status: 403 })
    return new Response('', { status: 201 })
  }) as unknown as typeof fetch

  await runBackup(ncJobId)

  const job = store().getJob(ncJobId)
  assert.equal(job?.lastStatus, 'success', 'the backup itself is fine')
  assert.equal(job?.lastError, null)
  assert.match(job!.lastCleanupError!, /403/)
})

test('a later clean run clears a recorded cleanup error', async () => {
  const jobId2 = localRetentionJob('Recovers', 'recovers', 2)
  store().setJobCleanupError(jobId2, 'stale failure from yesterday')
  globalThis.fetch = (async () => {
    throw new Error('local target must not use the network')
  }) as typeof fetch

  await runBackup(jobId2)

  assert.equal(store().getJob(jobId2)?.lastCleanupError, null)
})
