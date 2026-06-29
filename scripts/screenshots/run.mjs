// One-shot README screenshot harness: mock Docker socket → seed → built server
// (with host fixtures) → Playwright capture → teardown.
import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { rmSync, existsSync } from 'node:fs'

const PORT = 3200
const SOCK = '/tmp/srvkit-shots-docker.sock'
const DB = './.data/screenshots.db'

const ENV = {
  ...process.env,
  PORT: String(PORT),
  DATABASE_PATH: DB,
  COOKIE_SECURE: 'false',
  ENCRYPTION_KEY: 'screenshot-encryption-key',
  SHOT_PASS: 'screenshot-demo-pass',
  BACKUP_SOURCES_DIR: 'tests/fixtures/sources',
  HOST_PROC: 'tests/fixtures/host/proc',
  HOST_SYS: 'tests/fixtures/host/sys',
  HOST_ROOT: 'tests/fixtures/host/root',
  HOST_MTAB: 'tests/fixtures/host/etc/mtab',
  DOCKER_SOCKET: SOCK,
}

// Demo containers: four healthy, one long-dead (→ CRIT past grace).
const finished = new Date(Date.now() - 2 * 3600_000).toISOString()
const containers = [
  { name: 'postgres', state: 'running', finishedAt: '0001-01-01T00:00:00Z' },
  { name: 'redis', state: 'running', finishedAt: '0001-01-01T00:00:00Z' },
  { name: 'web-app', state: 'running', finishedAt: '0001-01-01T00:00:00Z' },
  { name: 'nginx', state: 'running', finishedAt: '0001-01-01T00:00:00Z' },
  { name: 'legacy-worker', state: 'exited', finishedAt: finished },
]

function startMock() {
  rmSync(SOCK, { force: true })
  const srv = createServer((req, res) => {
    req.resume()
    const url = req.url ?? ''
    let m
    if (req.method === 'GET' && url.startsWith('/containers/json')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify(
          containers.map((c) => ({
            Id: `id-${c.name}`,
            Names: [`/${c.name}`],
            Image: c.name === 'postgres' ? 'postgres:16' : c.name,
            State: c.state,
            Status: c.state === 'running' ? `Up (healthy)` : 'Exited (1) 2 hours ago',
          })),
        ),
      )
    } else if (req.method === 'GET' && (m = url.match(/^\/containers\/id-([^/]+)\/json$/))) {
      const c = containers.find((x) => x.name === m[1])
      res.writeHead(c ? 200 : 404, { 'content-type': 'application/json' })
      res.end(JSON.stringify(c ? { State: { Status: c.state, FinishedAt: c.finishedAt } } : {}))
    } else {
      res.writeHead(404)
      res.end('{}')
    }
  })
  return new Promise((resolve) => srv.listen(SOCK, () => resolve(srv)))
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/`)
      if (r.ok || r.status === 200) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('server did not start')
}

let server
const mock = await startMock()
try {
  if (!existsSync('.output/server/index.mjs')) {
    console.log('building…')
    execFileSync('npm', ['run', 'build'], { stdio: 'inherit' })
  }

  for (const ext of ['', '-wal', '-shm']) rmSync(DB + ext, { force: true })
  execFileSync('node', ['scripts/screenshots/seed.ts'], { stdio: 'inherit', env: ENV })

  server = spawn('node', ['.output/server/index.mjs'], { env: ENV, stdio: 'inherit' })
  await waitForServer()

  // Spawn (not execFileSync) so this process keeps serving the in-process mock
  // Docker socket while Playwright drives the pages.
  await new Promise((resolve, reject) => {
    const cap = spawn('node', ['scripts/screenshots/capture.mjs'], { env: ENV, stdio: 'inherit' })
    cap.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`capture exited ${code}`))))
    cap.on('error', reject)
  })
} finally {
  if (server) server.kill('SIGTERM')
  mock.close()
  rmSync(SOCK, { force: true })
}
console.log('screenshots written to docs/screenshots/')
