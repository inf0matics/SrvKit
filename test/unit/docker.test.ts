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

const { parseDockerFrames, listRunningContainers, pgDump, mysqlDump, dockerAvailable } =
  await import('../../server/utils/docker.ts')
const { store } = await import('../../server/utils/srvkit.ts')
const { encryptPassword } = await import('../../server/utils/backups.ts')
const { runBackup } = await import('../../server/utils/runner.ts')

// A Docker frame: [streamType, 0,0,0, size(uint32 BE)] + payload.
function frame(type: number, payload: string): Buffer {
  const header = Buffer.alloc(8)
  header[0] = type
  header.writeUInt32BE(payload.length, 4)
  return Buffer.concat([header, Buffer.from(payload)])
}

// Minimal mock Docker Engine API over a unix socket.
let server: Server
const realFetch = globalThis.fetch

// Records the body of the most recent exec-create call so tests can assert the
// command + env (e.g. mysqldump + MYSQL_PWD).
let lastExec: { Cmd: string[]; Env: string[] } | null = null

before(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? ''
    let m: RegExpMatchArray | null
    if (req.method === 'POST' && (m = url.match(/^\/containers\/([^/]+)\/exec$/))) {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        lastExec = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ Id: `exec-${decodeURIComponent(m![1]!)}` }))
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
    } else if (req.method === 'POST' && (m = url.match(/^\/exec\/exec-([^/]+)\/start$/))) {
      res.writeHead(200, { 'content-type': 'application/vnd.docker.raw-stream' })
      res.end(
        m[1] === 'bad'
          ? frame(2, 'FATAL: password authentication failed')
          : frame(1, `PG DUMP for ${m[1]}`),
      )
    } else if (req.method === 'GET' && (m = url.match(/^\/exec\/exec-([^/]+)\/json$/))) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ExitCode: m[1] === 'bad' ? 1 : 0 }))
    } else {
      res.writeHead(404)
      res.end('{}')
    }
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
})

beforeEach(() => {
  globalThis.fetch = realFetch
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
  assert.equal(dump.toString(), 'PG DUMP for pg')
})

test('pgDump throws on a non-zero exit with stderr detail', async () => {
  await assert.rejects(
    () => pgDump({ container: 'bad', database: 'app', user: 'u', password: 'p' }),
    /pg_dump exited 1.*password authentication failed/,
  )
})

test('mysqlDump runs mysqldump with the password in MYSQL_PWD (not on the cmdline)', async () => {
  const dump = await mysqlDump({ container: 'pg', database: 'app', user: 'root', password: 'sik' })
  assert.equal(dump.toString(), 'PG DUMP for pg') // mock returns stdout verbatim
  assert.deepEqual(lastExec!.Cmd, ['mysqldump', '-u', 'root', 'app'])
  assert.deepEqual(lastExec!.Env, ['MYSQL_PWD=sik'])
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

test('runBackup runs a MySQL job (mysqldump) and uploads the archive', async () => {
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
    trigger: 'cron',
    container: 'pg',
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
  assert.deepEqual(lastExec!.Cmd, ['mysqldump', '-u', 'root', 'app'])
  assert.match(calls.find((c) => c.method === 'PUT')!.url, /\/srvkit\/db\/mydb\.tar\.gz$/)
})
