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
const { pollDocker, readContainers, setContainerConfig, setAllEnabled, resetRuntime } =
  await import('../../server/utils/docker-monitor.ts')

// Mutable fixture the mock socket serves for /containers/json?all=1.
let containers: { Id: string; Names: string[]; Image: string; State: string }[] = []
const set = (name: string, state: string) => {
  containers = [{ Id: `id-${name}`, Names: [`/${name}`], Image: 'img', State: state }]
}

let server: Server
const realFetch = globalThis.fetch
let sent: string[] = []

before(async () => {
  server = createServer((req, res) => {
    req.resume()
    if (req.method === 'GET' && (req.url ?? '').startsWith('/containers/json')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(containers))
    } else {
      res.writeHead(404)
      res.end('{}')
    }
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
})

beforeEach(() => {
  sent = []
  resetRuntime()
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

const T0 = 1_000_000_000_000
const at = (sec: number) => T0 + sec * 1000

test('exited container: pending within grace, CRIT + one alert past grace', async () => {
  set('app', 'exited')
  setContainerConfig('app', { enabled: true, grace: 30 })

  await pollDocker(at(0)) // first seen offline → grace clock starts
  assert.equal(sent.length, 0)
  let row = (await readContainers(at(1))).containers.find((c) => c.name === 'app')!
  assert.equal(row.status, 'pending')
  assert.equal(row.pendingLevel, 'crit')

  await pollDocker(at(40)) // 40s > 30s grace → CRIT, alert fires
  assert.equal(sent.length, 1)
  assert.match(sent[0]!, /Container "app" is down \(exited, offline for 40s\)/)

  await pollDocker(at(50)) // still down → no repeat alert
  assert.equal(sent.length, 1)
  row = (await readContainers(at(50))).containers.find((c) => c.name === 'app')!
  assert.equal(row.status, 'crit')
})

test('recovery clears state silently; a new outage re-alerts', async () => {
  set('app', 'exited')
  setContainerConfig('app', { enabled: true, grace: 30 })
  await pollDocker(at(0))
  await pollDocker(at(40))
  assert.equal(sent.length, 1)

  set('app', 'running')
  await pollDocker(at(50)) // back to OK — no recovery message in v1
  assert.equal(sent.length, 1)

  set('app', 'exited')
  await pollDocker(at(60)) // grace clock restarts
  await pollDocker(at(100)) // 40s later → CRIT again → second alert
  assert.equal(sent.length, 2)
})

test('dead is CRIT immediately (no grace)', async () => {
  set('app', 'dead')
  setContainerConfig('app', { enabled: true, grace: 30 })
  await pollDocker(at(0))
  assert.equal(sent.length, 1)
  assert.match(sent[0]!, /is down \(dead/)
})

test('disabled containers never alert and read as off', async () => {
  set('app', 'dead')
  setContainerConfig('app', { enabled: false })
  await pollDocker(at(0))
  assert.equal(sent.length, 0)
  const row = (await readContainers(at(0))).containers.find((c) => c.name === 'app')!
  assert.equal(row.status, 'off')
  assert.equal(row.enabled, false)
})

test('readContainers reports the worst enabled status; running is OK', async () => {
  set('web', 'running')
  setContainerConfig('web', { enabled: true })
  const r = await readContainers(at(0))
  assert.equal(r.available, true)
  assert.equal(r.status, 'ok')
  assert.equal(r.containers.find((c) => c.name === 'web')!.status, 'ok')
})

test('setAllEnabled flips every discovered container', async () => {
  set('web', 'running')
  await setAllEnabled(true)
  assert.equal((await readContainers(at(0))).containers.find((c) => c.name === 'web')!.enabled, true)
  await setAllEnabled(false)
  assert.equal(
    (await readContainers(at(0))).containers.find((c) => c.name === 'web')!.enabled,
    false,
  )
})

test('grace below the 10s minimum is clamped', async () => {
  set('app', 'running')
  setContainerConfig('app', { enabled: true, grace: 2 })
  const row = (await readContainers(at(0))).containers.find((c) => c.name === 'app')!
  assert.equal(row.grace, 10)
})
