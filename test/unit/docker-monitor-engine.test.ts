import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Configure the environment before importing modules that read it.
const base = mkdtempSync(join(tmpdir(), 'srvkit-dockmon-'))
const socketPath = join(base, 'docker.sock')
process.env.DATABASE_PATH = join(base, 'db.sqlite')
process.env.ENCRYPTION_KEY = 'dockmon-test-key'
process.env.BACKUP_SOURCES_DIR = join(base, 'sources')
process.env.DOCKER_SOCKET = socketPath
delete process.env.TELEGRAM_BOT_TOKEN
delete process.env.TELEGRAM_CHAT_ID

const { store } = await import('../../server/utils/srvkit.ts')
const { saveAlertSettings } = await import('../../server/utils/alerts.ts')
const {
  pollDocker,
  readContainers,
  setContainerConfig,
  setAllEnabled,
  setCountMonitor,
  removeContainer,
  resetRuntime,
} = await import('../../server/utils/docker-monitor.ts')

// Mutable fixtures served over the mock socket. `finishedAt` feeds State.FinishedAt.
interface Fix {
  name: string
  state: string
  finishedAt: string | null
}
let fixtures: Fix[] = []
const ZERO = '0001-01-01T00:00:00Z'
const NOW = 1_700_000_000_000
const isoAt = (secAgo: number) => new Date(NOW - secAgo * 1000).toISOString()
const set = (...f: Fix[]) => {
  fixtures = f
}
const fx = (name: string, state: string, finishedAt: string | null = null): Fix => ({
  name,
  state,
  finishedAt,
})

let server: Server
const realFetch = globalThis.fetch
let sent: string[] = []

before(async () => {
  server = createServer((req, res) => {
    req.resume()
    const url = req.url ?? ''
    let m: RegExpMatchArray | null
    if (req.method === 'GET' && url.startsWith('/containers/json')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify(
          fixtures.map((f) => ({ Id: `id-${f.name}`, Names: [`/${f.name}`], Image: 'img', State: f.state })),
        ),
      )
    } else if (req.method === 'GET' && (m = url.match(/^\/containers\/id-([^/]+)\/json$/))) {
      const f = fixtures.find((x) => x.name === m![1])
      res.writeHead(f ? 200 : 404, { 'content-type': 'application/json' })
      res.end(JSON.stringify(f ? { State: { Status: f.state, FinishedAt: f.finishedAt ?? ZERO } } : {}))
    } else {
      res.writeHead(404)
      res.end('{}')
    }
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
})

beforeEach(() => {
  sent = []
  fixtures = []
  resetRuntime()
  // Fresh per-container + count config each test (the DB persists across tests).
  store().setConfig('docker_container_cfg', '{}')
  store().setConfig('docker_count_enabled', '0')
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sent.push((JSON.parse(init.body) as { text: string }).text)
    return { ok: true, status: 200, json: async () => ({}) } as Response
  }) as typeof fetch
  saveAlertSettings({ token: 'TKN', chatId: '123', enabled: true, recovery: true })
})

after(async () => {
  globalThis.fetch = realFetch
  await new Promise<void>((resolve) => server.close(() => resolve()))
  store().close()
  rmSync(base, { recursive: true, force: true })
})

const find = async (name: string) => (await readContainers(NOW)).containers.find((c) => c.name === name)!

test('running container is OK', async () => {
  set(fx('web', 'running'))
  setContainerConfig('web', { enabled: true })
  const r = await readContainers(NOW)
  assert.equal(r.status, 'ok')
  assert.equal(r.containers.find((c) => c.name === 'web')!.status, 'ok')
})

test('grace clock comes from FinishedAt: pending within, CRIT past — one alert', async () => {
  set(fx('app', 'exited', isoAt(5)))
  setContainerConfig('app', { enabled: true, grace: 30 })
  let row = await find('app')
  assert.equal(row.status, 'pending')
  assert.equal(row.pendingLevel, 'crit')
  assert.equal(Math.round(row.offlineFor!), 5)

  // Exited 40s ago → already past grace on the very first poll (no in-memory wait).
  set(fx('app', 'exited', isoAt(40)))
  await pollDocker(NOW)
  assert.equal(sent.length, 1)
  assert.match(sent[0]!, /Container "app" is down \(exited, offline for 40s\)/)
  await pollDocker(NOW) // still down → no repeat
  assert.equal(sent.length, 1)
  row = await find('app')
  assert.equal(row.status, 'crit')
})

test('FinishedAt grace survives a restart (resetRuntime)', async () => {
  set(fx('app', 'exited', isoAt(100)))
  setContainerConfig('app', { enabled: true, grace: 30 })
  resetRuntime() // simulate SrvKit restart / dev HMR reload
  const row = await find('app')
  assert.equal(row.status, 'crit') // still CRIT — clock is FinishedAt, not in-memory
  await pollDocker(NOW)
  assert.equal(sent.length, 1) // re-alerts once after the restart
})

test('recovery sends one message; a new outage re-alerts', async () => {
  set(fx('app', 'exited', isoAt(40)))
  setContainerConfig('app', { enabled: true, grace: 30 })
  await pollDocker(NOW)
  assert.equal(sent.length, 1)
  assert.match(sent[0]!, /is down/)

  set(fx('app', 'running'))
  await pollDocker(NOW)
  assert.equal(sent.length, 2)
  assert.match(sent[1]!, /Container "app" is running again\./)

  await pollDocker(NOW) // still running → no repeat
  assert.equal(sent.length, 2)

  set(fx('app', 'exited', isoAt(40)))
  await pollDocker(NOW)
  assert.equal(sent.length, 3)
})

test('recovery is suppressed when the recovery toggle is off', async () => {
  saveAlertSettings({ recovery: false })
  set(fx('app', 'exited', isoAt(40)))
  setContainerConfig('app', { enabled: true, grace: 30 })
  await pollDocker(NOW)
  assert.equal(sent.length, 1)

  set(fx('app', 'running'))
  await pollDocker(NOW)
  assert.equal(sent.length, 1) // no recovery message
})

test('disabling a downed container does not send a recovery message', async () => {
  set(fx('app', 'exited', isoAt(40)))
  setContainerConfig('app', { enabled: true, grace: 30 })
  await pollDocker(NOW)
  assert.equal(sent.length, 1)

  setContainerConfig('app', { enabled: false })
  await pollDocker(NOW)
  assert.equal(sent.length, 1) // disabling is silent, not a "recovered"
})

test('a removed container that comes back sends a recovery message', async () => {
  set(fx('svc', 'running'))
  setContainerConfig('svc', { enabled: true })
  await pollDocker(NOW) // baseline: known + running

  set() // svc vanishes → removed CRIT + one alert
  await pollDocker(NOW)
  assert.equal(sent.length, 1)
  assert.match(sent[0]!, /has been removed/)

  set(fx('svc', 'running')) // comes back
  await pollDocker(NOW)
  assert.equal(sent.length, 2)
  assert.match(sent[1]!, /Container "svc" is running again\./)
})

test('dead is CRIT immediately regardless of FinishedAt', async () => {
  set(fx('app', 'dead', isoAt(1)))
  setContainerConfig('app', { enabled: true, grace: 30 })
  await pollDocker(NOW)
  assert.equal(sent.length, 1)
  assert.match(sent[0]!, /is down \(dead/)
})

test('runtime discovery: a new container is auto-added as disabled', async () => {
  set(fx('newbie', 'running'))
  const row = await find('newbie')
  assert.equal(row.enabled, false)
  assert.equal(row.status, 'off')
  // Persisted in the registry.
  assert.ok('newbie' in JSON.parse(store().getConfig('docker_container_cfg')!))
})

test('removed while enabled → immediate CRIT row + one alert, kept until cleared', async () => {
  set(fx('svc', 'running'))
  setContainerConfig('svc', { enabled: true })
  await pollDocker(NOW) // baseline: svc known + running

  set() // svc vanishes from Docker
  await pollDocker(NOW)
  assert.equal(sent.length, 1)
  assert.match(sent[0]!, /Container "svc" has been removed\./)

  const row = await find('svc')
  assert.equal(row.removed, true)
  assert.equal(row.state, 'removed')
  assert.equal(row.status, 'crit')

  await pollDocker(NOW) // no duplicate alert
  assert.equal(sent.length, 1)

  removeContainer('svc') // user clears the row
  assert.equal((await readContainers(NOW)).containers.find((c) => c.name === 'svc'), undefined)
})

test('removed while disabled → silently dropped, no alert', async () => {
  set(fx('temp', 'exited', isoAt(5)))
  await readContainers(NOW) // discovered (disabled)
  set() // vanishes
  await pollDocker(NOW)
  assert.equal(sent.length, 0)
  assert.equal((await readContainers(NOW)).containers.find((c) => c.name === 'temp'), undefined)
})

test('count summary reports states; change of running count alerts when enabled', async () => {
  set(fx('a', 'running'), fx('b', 'running'), fx('c', 'exited', isoAt(5)))
  let r = await readContainers(NOW)
  assert.deepEqual(r.counts, { running: 2, exited: 1, paused: 0, dead: 0 })

  setCountMonitor(true)
  await pollDocker(NOW) // baseline running=2, no alert
  assert.equal(sent.length, 0)

  set(fx('a', 'running'), fx('b', 'exited', isoAt(2)), fx('c', 'exited', isoAt(5)))
  await pollDocker(NOW) // running 2 → 1
  assert.equal(sent.length, 1)
  assert.match(sent[0]!, /count changed — running: 1, exited: 2, paused: 0, dead: 0/)

  r = await readContainers(NOW)
  assert.equal(r.countEnabled, true)
})

test('count change does not alert when the monitor is disabled', async () => {
  set(fx('a', 'running'), fx('b', 'running'))
  await pollDocker(NOW)
  set(fx('a', 'running'))
  await pollDocker(NOW)
  assert.equal(sent.length, 0)
})

test('setAllEnabled flips every known container', async () => {
  set(fx('web', 'running'))
  await readContainers(NOW) // discover web
  await setAllEnabled(true)
  assert.equal((await find('web')).enabled, true)
  await setAllEnabled(false)
  assert.equal((await find('web')).enabled, false)
})

test('grace below the 10s minimum is clamped', async () => {
  set(fx('app', 'running'))
  setContainerConfig('app', { enabled: true, grace: 2 })
  assert.equal((await find('app')).grace, 10)
})
