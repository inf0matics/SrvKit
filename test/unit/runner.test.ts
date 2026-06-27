import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// Configure the environment before importing modules that read it.
const base = mkdtempSync(join(tmpdir(), 'srvkit-runner-'))
process.env.DATABASE_PATH = join(base, 'db.sqlite')
process.env.ENCRYPTION_KEY = 'runner-test-key'
process.env.BACKUP_SOURCES_DIR = join(base, 'sources')

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
