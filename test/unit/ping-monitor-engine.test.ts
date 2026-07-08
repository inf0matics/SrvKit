import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { FetchLike } from '../../server/utils/ping-monitor.ts'

// Configure the environment before importing modules that read it.
const dir = mkdtempSync(join(tmpdir(), 'srvkit-pingmon-'))
process.env.DATABASE_PATH = join(dir, 'db.sqlite')
process.env.ENCRYPTION_KEY = 'pingmon-test-key'
process.env.BACKUP_SOURCES_DIR = join(dir, 'sources')
delete process.env.TELEGRAM_BOT_TOKEN
delete process.env.TELEGRAM_CHAT_ID

const { store } = await import('../../server/utils/srvkit.ts')
const { saveAlertSettings } = await import('../../server/utils/alerts.ts')
const { createPing, updatePing, deletePing, pollPings, readPings, resetPingRuntime } = await import(
  '../../server/utils/ping-monitor.ts'
)

// A real target server the checks hit. `status` is mutable per test; a couple of
// fixed routes exercise redirect handling.
let status = 200
let server: Server
let base = ''
// Real fetch for the ping checks (globalThis.fetch is overridden to capture alerts).
const realFetch = globalThis.fetch.bind(globalThis) as unknown as FetchLike
let sent: string[] = []

before(async () => {
  server = createServer((req, res) => {
    req.resume()
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/target' })
      res.end()
    } else if (req.url === '/loop') {
      res.writeHead(302, { location: '/loop' })
      res.end()
    } else {
      res.writeHead(status)
      res.end('ok')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  store().close()
  rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  sent = []
  status = 200
  resetPingRuntime()
  store().setConfig('pings', '[]')
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sent.push((JSON.parse(init.body) as { text: string }).text)
    return { ok: true, status: 200, json: async () => ({}) } as Response
  }) as typeof fetch
  saveAlertSettings({ token: 'TKN', chatId: '123', enabled: true, recovery: true })
})

test('a healthy ping is OK with no alert', async () => {
  await createPing({ url: `${base}/`, intervalSec: 60 }, `${base}/`, realFetch)
  const row = readPings().pings[0]!
  assert.equal(row.status, 'ok')
  assert.equal(row.lastCode, 200)
  assert.equal(sent.length, 0)
})

test('wrong status alerts once on the transition, not on repeat', async () => {
  status = 500
  const def = await createPing({ url: `${base}/`, intervalSec: 60 }, `${base}/`, realFetch)
  // Baseline check (silent) already marks it crit; the poll fires the alert.
  assert.equal(readPings().pings[0]!.status, 'crit')
  assert.equal(sent.length, 0)

  const t0 = Date.now()
  await pollPings(t0 + 61_000, realFetch)
  assert.equal(sent.length, 1)
  assert.match(sent[0]!, /Ping ".+" failed — got 500, expected 200\./)

  await pollPings(t0 + 122_000, realFetch) // still down → no repeat
  assert.equal(sent.length, 1)

  assert.ok(readPings().pings.find((p) => p.id === def.id)!.failingSince! >= 0)
})

test('recovery fires a recovered message', async () => {
  status = 503
  await createPing({ url: `${base}/`, intervalSec: 60 }, `${base}/`, realFetch)
  const t0 = Date.now()
  await pollPings(t0 + 61_000, realFetch)
  assert.equal(sent.length, 1)

  status = 200
  await pollPings(t0 + 122_000, realFetch)
  assert.equal(sent.length, 2)
  assert.match(sent[1]!, /recovered — 200 OK\./)
  const row = readPings().pings[0]!
  assert.equal(row.status, 'ok')
  assert.equal(row.failingSince, null)
})

test('redirects are followed to the final status', async () => {
  await createPing({ url: `${base}/redirect`, intervalSec: 60 }, `${base}/redirect`, realFetch)
  assert.equal(readPings().pings[0]!.status, 'ok') // 302 → /target → 200
})

test('a redirect loop is capped (stops at the 3xx → crit vs 200)', async () => {
  await createPing({ url: `${base}/loop`, intervalSec: 60 }, `${base}/loop`, realFetch)
  const row = readPings().pings[0]!
  assert.equal(row.status, 'crit')
  assert.equal(row.lastCode, 302)
})

test('connection failure is crit with a request-failed alert', async () => {
  // Point at a closed port for a fast ECONNREFUSED.
  const dead = 'http://127.0.0.1:1'
  await createPing({ url: dead, intervalSec: 60 }, dead, realFetch)
  const row = readPings().pings[0]!
  assert.equal(row.status, 'crit')
  assert.equal(row.lastCode, null)

  await pollPings(Date.now() + 61_000, realFetch)
  assert.equal(sent.length, 1)
  assert.match(sent[0]!, /failed — request connection failed, expected 200\./)
})

test('a disabled ping is not polled and shows off', async () => {
  status = 500
  const def = await createPing({ url: `${base}/`, intervalSec: 60 }, `${base}/`, realFetch)
  await updatePing(def.id, { enabled: false }, null, realFetch)
  assert.equal(readPings().pings[0]!.status, 'off')

  await pollPings(Date.now() + 61_000, realFetch)
  assert.equal(sent.length, 0)
})

test('poll skips a ping that is not yet due', async () => {
  status = 500
  await createPing({ url: `${base}/`, intervalSec: 300 }, `${base}/`, realFetch)
  await pollPings(Date.now() + 10_000, realFetch) // only 10s elapsed, interval 300s
  assert.equal(sent.length, 0)
})

test('the display name is used in alerts when set', async () => {
  status = 500
  await createPing(
    { url: `${base}/`, name: 'API health', intervalSec: 60 },
    `${base}/`,
    realFetch,
  )
  await pollPings(Date.now() + 61_000, realFetch)
  assert.match(sent[0]!, /Ping "API health" failed/)
})

test('aggregate is worst-of; disabling the crit clears the badge', async () => {
  await createPing({ url: `${base}/`, intervalSec: 60 }, `${base}/`, realFetch) // ok
  status = 500
  const bad = await createPing({ url: `${base}/`, intervalSec: 60 }, `${base}/`, realFetch)
  assert.equal(readPings().status, 'crit')

  await updatePing(bad.id, { enabled: false }, null, realFetch)
  assert.equal(readPings().status, 'ok')
  assert.equal(readPings().anyEnabled, true)

  deletePing(bad.id)
  assert.equal(readPings().pings.length, 1)
})
