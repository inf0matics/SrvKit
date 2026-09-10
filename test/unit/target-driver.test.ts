import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Configure the environment before importing modules that read it.
const base = mkdtempSync(join(tmpdir(), 'srvkit-driver-'))
process.env.DATABASE_PATH = join(base, 'db.sqlite')
process.env.ENCRYPTION_KEY = 'driver-test-key'
process.env.BACKUP_TARGETS_DIR = join(base, 'targets')

const { driverFor, targetsDir } = await import('../../server/utils/target-driver.ts')

const realFetch = globalThis.fetch
beforeEach(() => {
  globalThis.fetch = realFetch
  rmSync(join(base, 'targets'), { recursive: true, force: true })
  mkdirSync(join(base, 'targets'), { recursive: true })
})
after(() => {
  globalThis.fetch = realFetch
  rmSync(base, { recursive: true, force: true })
})

const local = (rootDir = '') => ({
  type: 'local',
  host: '',
  username: '',
  password: '',
  rootDir,
})
const nextcloud = {
  type: 'nextcloud',
  host: 'https://nc.example.com',
  username: 'alice',
  password: 's3cret',
  rootDir: 'srvkit',
}

/* ---- the base directory ---- */

test('targetsDir honours BACKUP_TARGETS_DIR', () => {
  assert.equal(targetsDir(), join(base, 'targets'))
})

/* ---- dispatch: local ---- */

test('local driver tests writability of the target root', async () => {
  mkdirSync(join(base, 'targets', 'nas'))
  const res = await driverFor(local('nas')).test()
  assert.equal(res.ok, true)
  assert.match(res.message, /writable/i)
})

test('local driver test fails for a root outside the base', async () => {
  const res = await driverFor(local('../escape')).test()
  assert.equal(res.ok, false)
  assert.match(res.message, /outside/i)
})

test('local driver browses inside the base', async () => {
  mkdirSync(join(base, 'targets', 'nas'))
  mkdirSync(join(base, 'targets', 'media'))
  const res = await driverFor(local()).browse('')
  assert.equal(res.ok, true)
  assert.deepEqual(res.dirs, ['media', 'nas'])
})

test('local driver uploads relative to the target root', async () => {
  await driverFor(local('nas')).upload('nas/db/backup.tar.gz', Buffer.from('data'))
  assert.equal(readFileSync(join(base, 'targets', 'nas/db/backup.tar.gz'), 'utf8'), 'data')
})

test('local driver lists and deletes files', async () => {
  const d = driverFor(local('nas'))
  mkdirSync(join(base, 'targets', 'nas'), { recursive: true })
  writeFileSync(join(base, 'targets', 'nas/a.tar.gz'), 'a')
  writeFileSync(join(base, 'targets', 'nas/b.tar.gz'), 'b')
  assert.deepEqual((await d.list('nas')).sort(), ['a.tar.gz', 'b.tar.gz'])
  await d.delete('nas/a.tar.gz')
  assert.equal(existsSync(join(base, 'targets', 'nas/a.tar.gz')), false)
  assert.deepEqual(await d.list('nas'), ['b.tar.gz'])
})

/* ---- dispatch: nextcloud ---- */

test('nextcloud driver tests over WebDAV PROPFIND', async () => {
  let seen: { url: string; method: string } | null = null
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen = { url: String(url), method: init.method! }
    return new Response('', { status: 207 })
  }) as unknown as typeof fetch
  const res = await driverFor(nextcloud).test()
  assert.equal(res.ok, true)
  assert.equal(seen!.method, 'PROPFIND')
  assert.match(seen!.url, /remote\.php\/dav\/files\/alice/)
})

test('nextcloud driver uploads with a PUT', async () => {
  const calls: string[] = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url}`)
    return new Response('', { status: 201 })
  }) as unknown as typeof fetch
  await driverFor(nextcloud).upload('srvkit/db/backup.tar.gz', Buffer.from('data'))
  assert.ok(calls.some((c) => c.startsWith('MKCOL')), 'creates parents')
  assert.ok(
    calls.some((c) => c === 'PUT https://nc.example.com/remote.php/dav/files/alice/srvkit/db/backup.tar.gz'),
  )
})

const listXml = `<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/remote.php/dav/files/alice/srvkit/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
  <d:response><d:href>/remote.php/dav/files/alice/srvkit/db_2026-09-10.tar.gz</d:href>
    <d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
</d:multistatus>`

test('nextcloud driver lists files via PROPFIND Depth 1', async () => {
  let depth = ''
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    depth = (init.headers as Record<string, string>).Depth!
    return new Response(listXml, { status: 207 })
  }) as unknown as typeof fetch
  assert.deepEqual(await driverFor(nextcloud).list('srvkit'), ['db_2026-09-10.tar.gz'])
  assert.equal(depth, '1')
})

test('nextcloud driver list throws on an error response', async () => {
  globalThis.fetch = (async () => new Response('', { status: 401 })) as unknown as typeof fetch
  await assert.rejects(() => driverFor(nextcloud).list('srvkit'), /401/)
})

test('nextcloud driver deletes with a DELETE', async () => {
  let seen = ''
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen = `${init.method} ${url}`
    return new Response(null, { status: 204 })
  }) as unknown as typeof fetch
  await driverFor(nextcloud).delete('srvkit/old.tar.gz')
  assert.equal(
    seen,
    'DELETE https://nc.example.com/remote.php/dav/files/alice/srvkit/old.tar.gz',
  )
})

test('nextcloud driver treats a missing file as already deleted', async () => {
  globalThis.fetch = (async () => new Response('', { status: 404 })) as unknown as typeof fetch
  await driverFor(nextcloud).delete('srvkit/gone.tar.gz')
})

test('nextcloud driver delete throws on a real failure', async () => {
  globalThis.fetch = (async () => new Response('', { status: 403 })) as unknown as typeof fetch
  await assert.rejects(() => driverFor(nextcloud).delete('srvkit/x.tar.gz'), /403/)
})
