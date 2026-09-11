import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Configure the environment before importing modules that read it.
const base = mkdtempSync(join(tmpdir(), 'srvkit-docker-'))
const socketPath = join(base, 'docker.sock')
process.env.DATABASE_PATH = join(base, 'db.sqlite')
process.env.ENCRYPTION_KEY = 'docker-test-key'
process.env.BACKUP_SOURCES_DIR = join(base, 'sources')
process.env.DOCKER_SOCKET = socketPath

const {
  parseDockerFrames,
  listRunningContainers,
  pgDump,
  mysqlDump,
  resolveDumpBinary,
  dockerAvailable,
} = await import('../../server/utils/docker.ts')
const { store } = await import('../../server/utils/srvkit.ts')
const { encryptPassword } = await import('../../server/utils/backups.ts')
const { runBackup } = await import('../../server/utils/runner.ts')

// A Docker frame: [streamType, 0,0,0, size(uint32 BE)] + payload.
function frame(type: number, payload: string): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(payload.length, 4)
  header[0] = type
  return Buffer.concat([header, Buffer.from(payload)])
}

// Minimal mock Docker Engine API over a unix socket.
let server: Server
const realFetch = globalThis.fetch

// Every exec-create call, so tests can assert both the binary probe and the
// dump command that follows it (cmd + env, e.g. mysqldump + MYSQL_PWD).
let execCalls: { Cmd: string[]; Env: string[] }[] = []
const lastExec = () => execCalls[execCalls.length - 1]!

// What `command -v mariadb-dump || command -v mysqldump` prints per container.
// `upgrading` flips from MySQL to MariaDB between runs — the image-upgrade case.
let upgradingProbes = 0
function probeResult(container: string): { out: string; code: number } {
  if (container === 'mariadb11') return { out: '/usr/bin/mariadb-dump\n', code: 0 }
  if (container === 'mysql8') return { out: '/usr/bin/mysqldump\n', code: 0 }
  if (container === 'nodump') return { out: '', code: 1 }
  if (container === 'upgrading') {
    return upgradingProbes++ === 0
      ? { out: '/usr/bin/mysqldump\n', code: 0 }
      : { out: '/usr/bin/mariadb-dump\n', code: 0 }
  }
  return { out: '/usr/bin/mysqldump\n', code: 0 }
}

before(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? ''
    let m: RegExpMatchArray | null
    if (req.method === 'POST' && (m = url.match(/^\/containers\/([^/]+)\/exec$/))) {
      const container = decodeURIComponent(m[1]!)
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        execCalls.push(body)
        // The binary probe runs through `sh -c`; anything else is the dump.
        const kind = body.Cmd?.[0] === 'sh' ? 'probe' : 'dump'
        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ Id: `exec-${container}-${kind}` }))
      })
      return
    }
    req.resume() // drain request body
    if (req.method === 'GET' && url === '/containers/json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify([
          { Id: 'c1', Names: ['/pg'], Image: 'postgres:16' },
          { Id: 'c2', Names: ['/cache'], Image: 'redis' },
        ]),
      )
    } else if (
      req.method === 'POST' &&
      (m = url.match(/^\/exec\/exec-(.+)-(probe|dump)\/start$/))
    ) {
      const [container, kind] = [m[1]!, m[2]!]
      res.writeHead(200, { 'content-type': 'application/vnd.docker.raw-stream' })
      if (kind === 'probe') {
        res.end(frame(1, probeResult(container).out))
      } else if (container === 'bad') {
        res.end(frame(2, 'FATAL: password authentication failed'))
      } else if (container === 'emptydump') {
        res.end(frame(1, '')) // exits 0, streams nothing — the silent failure
      } else {
        res.end(frame(1, `DUMP for ${container}`))
      }
    } else if (
      req.method === 'GET' &&
      (m = url.match(/^\/exec\/exec-(.+)-(probe|dump)\/json$/))
    ) {
      const [container, kind] = [m[1]!, m[2]!]
      const code =
        kind === 'probe' ? probeResult(container).code : container === 'bad' ? 1 : 0
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ExitCode: code }))
    } else {
      res.writeHead(404)
      res.end('{}')
    }
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
})

beforeEach(() => {
  globalThis.fetch = realFetch
  execCalls = []
})

after(async () => {
  globalThis.fetch = realFetch
  await new Promise<void>((resolve) => server.close(() => resolve()))
  store().close()
  rmSync(base, { recursive: true, force: true })
})

test('parseDockerFrames splits stdout and stderr', () => {
  const buf = Buffer.concat([frame(1, 'hello '), frame(2, 'oops'), frame(1, 'world')])
  const { stdout, stderr } = parseDockerFrames(buf)
  assert.equal(stdout.toString(), 'hello world')
  assert.equal(stderr.toString(), 'oops')
})

test('parseDockerFrames ignores a truncated trailing frame', () => {
  const good = frame(1, 'ok')
  const truncated = good.subarray(0, good.length - 1)
  const { stdout } = parseDockerFrames(Buffer.concat([good, truncated]))
  assert.equal(stdout.toString(), 'ok')
})

test('dockerAvailable is true when the socket exists', () => {
  assert.equal(dockerAvailable(), true)
})

test('listRunningContainers strips the leading slash from names', async () => {
  const containers = await listRunningContainers()
  assert.deepEqual(
    containers.map((c) => c.name),
    ['pg', 'cache'],
  )
})

test('pgDump returns the SQL dump from stdout', async () => {
  const dump = await pgDump({ container: 'pg', database: 'app', user: 'u', password: 'p' })
  assert.equal(dump.toString(), 'DUMP for pg')
})

test('pgDump throws on a non-zero exit with stderr detail', async () => {
  await assert.rejects(
    () => pgDump({ container: 'bad', database: 'app', user: 'u', password: 'p' }),
    /pg_dump exited 1.*password authentication failed/,
  )
})

test('resolveDumpBinary probes mariadb-dump before mysqldump', async () => {
  const binary = await resolveDumpBinary('mariadb11')
  assert.equal(binary, '/usr/bin/mariadb-dump')
  assert.deepEqual(lastExec().Cmd, [
    'sh',
    '-c',
    'command -v mariadb-dump || command -v mysqldump',
  ])
})

test('resolveDumpBinary returns null when neither binary exists', async () => {
  assert.equal(await resolveDumpBinary('nodump'), null)
})

test('mysqlDump uses mariadb-dump on MariaDB >= 11', async () => {
  const dump = await mysqlDump({
    container: 'mariadb11',
    database: 'app',
    user: 'root',
    password: 'sik',
  })
  assert.equal(dump.toString(), 'DUMP for mariadb11')
  assert.deepEqual(lastExec().Cmd, ['/usr/bin/mariadb-dump', '-u', 'root', 'app'])
})

test('mysqlDump falls back to mysqldump with the password in MYSQL_PWD', async () => {
  const dump = await mysqlDump({
    container: 'mysql8',
    database: 'app',
    user: 'root',
    password: 'sik',
  })
  assert.equal(dump.toString(), 'DUMP for mysql8')
  assert.deepEqual(lastExec().Cmd, ['/usr/bin/mysqldump', '-u', 'root', 'app'])
  assert.deepEqual(lastExec().Env, ['MYSQL_PWD=sik'])
})

test('mysqlDump names both candidates when the container has neither', async () => {
  await assert.rejects(
    () =>
      mysqlDump({ container: 'nodump', database: 'app', user: 'root', password: 'p' }),
    /No dump binary found in container nodump \(looked for mariadb-dump, mysqldump\)/,
  )
  // Only the probe ran — no dump was attempted against a missing binary.
  assert.equal(execCalls.length, 1)
})

test('mysqlDump re-resolves the binary on every run (image upgrade needs no reconfig)', async () => {
  const opts = { container: 'upgrading', database: 'app', user: 'root', password: 'p' }
  await mysqlDump(opts)
  assert.deepEqual(lastExec().Cmd, ['/usr/bin/mysqldump', '-u', 'root', 'app'])
  await mysqlDump(opts)
  assert.deepEqual(lastExec().Cmd, ['/usr/bin/mariadb-dump', '-u', 'root', 'app'])
})

test('runBackup runs a PostgreSQL job and uploads the archive', async () => {
  const targetId = store().createTarget({
    name: 'T',
    host: 'https://nc.example.com',
    username: 'alice',
    password: encryptPassword('secret'),
    rootDir: 'srvkit',
  }).id
  const jobId = store().createJob({
    targetId,
    name: 'pgdb',
    type: 'postgres',
    sourcePath: '',
    includes: [],
    output: 'single',
    subdirectory: 'db',
    dateSuffix: false,
    timeSuffix: false,
    keepVersions: 0,
    rotation: 'off',
    trigger: 'filewatcher',
    container: 'pg',
    database: 'app',
    dbUser: 'postgres',
    dbPassword: encryptPassword('s3cret'),
    schedule: '0 3 * * *',
  }).id

  const calls: { method: string; url: string }[] = []
  globalThis.fetch = (async (url: string, init: { method: string }) => {
    calls.push({ method: init.method, url: String(url) })
    return { ok: true, status: 201 } as Response
  }) as typeof fetch

  await runBackup(jobId)

  assert.equal(store().getJob(jobId)?.lastStatus, 'success')
  const put = calls.find((c) => c.method === 'PUT')
  assert.match(put!.url, /\/srvkit\/db\/pgdb\.tar\.gz$/)
})

test('runBackup runs a MySQL job against MariaDB 11 and uploads the archive', async () => {
  const targetId = store().createTarget({
    name: 'T2',
    host: 'https://nc.example.com',
    username: 'bob',
    password: encryptPassword('secret'),
    rootDir: 'srvkit',
  }).id
  const jobId = store().createJob({
    targetId,
    name: 'mydb',
    type: 'mysql',
    sourcePath: '',
    includes: [],
    output: 'single',
    subdirectory: 'db',
    dateSuffix: false,
    timeSuffix: false,
    keepVersions: 0,
    rotation: 'off',
    trigger: 'cron',
    container: 'mariadb11',
    database: 'app',
    dbUser: 'root',
    dbPassword: encryptPassword('s3cret'),
    schedule: '0 3 * * *',
  }).id

  const calls: { method: string; url: string }[] = []
  globalThis.fetch = (async (url: string, init: { method: string }) => {
    calls.push({ method: init.method, url: String(url) })
    return { ok: true, status: 201 } as Response
  }) as typeof fetch

  await runBackup(jobId)

  assert.equal(store().getJob(jobId)?.lastStatus, 'success')
  assert.deepEqual(lastExec().Cmd, ['/usr/bin/mariadb-dump', '-u', 'root', 'app'])
  assert.match(calls.find((c) => c.method === 'PUT')!.url, /\/srvkit\/db\/mydb\.tar\.gz$/)
})

test('runBackup fails a MySQL job with no dump binary and uploads nothing', async () => {
  const targetId = store().createTarget({
    name: 'T3',
    host: 'https://nc.example.com',
    username: 'bob',
    password: encryptPassword('secret'),
    rootDir: 'srvkit',
  }).id
  const jobId = store().createJob({
    targetId,
    name: 'nodumpdb',
    type: 'mysql',
    sourcePath: '',
    includes: [],
    output: 'single',
    subdirectory: 'db',
    dateSuffix: false,
    timeSuffix: false,
    keepVersions: 0,
    rotation: 'off',
    trigger: 'cron',
    container: 'nodump',
    database: 'app',
    dbUser: 'root',
    dbPassword: encryptPassword('s3cret'),
    schedule: '0 3 * * *',
  }).id

  const calls: { method: string; url: string }[] = []
  globalThis.fetch = (async (url: string, init: { method: string }) => {
    calls.push({ method: init.method, url: String(url) })
    return { ok: true, status: 201 } as Response
  }) as typeof fetch

  await runBackup(jobId)

  const job = store().getJob(jobId)
  assert.equal(job?.lastStatus, 'failed')
  assert.match(
    job!.lastError!,
    /No dump binary found in container nodump \(looked for mariadb-dump, mysqldump\)/,
  )
  assert.equal(
    calls.find((c) => c.method === 'PUT'),
    undefined,
  )
})

test('runBackup fails a MySQL job whose dump is empty and uploads nothing', async () => {
  const targetId = store().createTarget({
    name: 'T4',
    host: 'https://nc.example.com',
    username: 'bob',
    password: encryptPassword('secret'),
    rootDir: 'srvkit',
  }).id
  const jobId = store().createJob({
    targetId,
    name: 'emptydb',
    type: 'mysql',
    sourcePath: '',
    includes: [],
    output: 'single',
    subdirectory: 'db',
    dateSuffix: false,
    timeSuffix: false,
    keepVersions: 0,
    rotation: 'off',
    trigger: 'cron',
    container: 'emptydump',
    database: 'app',
    dbUser: 'root',
    dbPassword: encryptPassword('s3cret'),
    schedule: '0 3 * * *',
  }).id

  const calls: { method: string; url: string }[] = []
  globalThis.fetch = (async (url: string, init: { method: string }) => {
    calls.push({ method: init.method, url: String(url) })
    return { ok: true, status: 201 } as Response
  }) as typeof fetch

  await runBackup(jobId)

  const job = store().getJob(jobId)
  assert.equal(job?.lastStatus, 'failed')
  assert.equal(job?.lastError, 'Dump produced 0 bytes — nothing was backed up')
  assert.equal(job?.lastBytes, 0)
  assert.equal(
    calls.find((c) => c.method === 'PUT'),
    undefined,
  )
})

test('runBackup records the dump byte count on a successful MySQL run', async () => {
  const targetId = store().createTarget({
    name: 'T5',
    host: 'https://nc.example.com',
    username: 'bob',
    password: encryptPassword('secret'),
    rootDir: 'srvkit',
  }).id
  const jobId = store().createJob({
    targetId,
    name: 'sizedb',
    type: 'mysql',
    sourcePath: '',
    includes: [],
    output: 'single',
    subdirectory: 'db',
    dateSuffix: false,
    timeSuffix: false,
    keepVersions: 0,
    rotation: 'off',
    trigger: 'cron',
    container: 'mysql8',
    database: 'app',
    dbUser: 'root',
    dbPassword: encryptPassword('s3cret'),
    schedule: '0 3 * * *',
  }).id

  globalThis.fetch = (async () => ({ ok: true, status: 201 }) as Response) as typeof fetch
  await runBackup(jobId)

  const job = store().getJob(jobId)
  assert.equal(job?.lastStatus, 'success')
  assert.equal(job?.lastBytes, 'DUMP for mysql8'.length)
})
