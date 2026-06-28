import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Configure the environment before importing modules that read it.
const base = mkdtempSync(join(tmpdir(), 'srvkit-host-'))
const proc = join(base, 'proc')
const sys = join(base, 'sys')
process.env.DATABASE_PATH = join(base, 'db.sqlite')
process.env.ENCRYPTION_KEY = 'host-test-key'
process.env.HOST_PROC = proc
process.env.HOST_SYS = sys

mkdirSync(join(proc, 'sys', 'fs'), { recursive: true })
mkdirSync(sys, { recursive: true })
writeFileSync(join(proc, 'stat'), 'cpu  1000 0 500 8000 500 0 0 0 0 0\n')
writeFileSync(join(proc, 'loadavg'), '0.50 0.40 0.30 1/234 5678\n')
writeFileSync(join(proc, 'cpuinfo'), 'processor\t: 0\nprocessor\t: 1\n')
writeFileSync(
  join(proc, 'meminfo'),
  'MemTotal: 1000000 kB\nMemAvailable: 150000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n',
)
writeFileSync(join(proc, 'uptime'), '123456.78 100000.00\n')
writeFileSync(join(proc, 'version'), 'Linux version 6.1.0-test (deb@host) gcc\n')
writeFileSync(join(proc, 'sys', 'fs', 'file-nr'), '1024\t0\t100000\n')

const host = await import('../../server/utils/host.ts')
const { store } = await import('../../server/utils/srvkit.ts')

const find = (id: string) => host.readMetrics().metrics.find((m) => m.id === id)!

after(() => {
  store().close()
  rmSync(base, { recursive: true, force: true })
})

test('mounts are detected as present', () => {
  assert.ok(host.mounts().every((m) => m.present))
})

test('RAM at 85% is WARN; aggregate reflects the worst metric', () => {
  assert.equal(find('ram_usage').display, '85%')
  assert.equal(find('ram_usage').status, 'warn')
  assert.equal(host.readMetrics().status, 'warn')
})

test('no swap → OK with a note', () => {
  const swap = find('swap_usage')
  assert.equal(swap.status, 'ok')
  assert.equal(swap.note, 'no swap configured')
})

test('CPU temp is "not available" without a thermal zone', () => {
  assert.equal(find('cpu_temp').display, 'not available')
  assert.equal(find('cpu_temp').status, 'na')
})

test('uptime + kernel are informational', () => {
  assert.equal(find('uptime').status, 'info')
  assert.equal(find('uptime').display, '1d 10h 17m')
  assert.equal(find('kernel').display, '6.1.0-test')
})

test('threshold override changes the status', () => {
  host.setMetricConfig('ram_usage', { warn: 90, crit: 95 })
  assert.equal(find('ram_usage').status, 'ok') // 85 < 90
  host.setMetricConfig('ram_usage', { warn: 80, crit: 90 }) // restore
})

test('disabling a metric marks it off and drops it from the aggregate', () => {
  host.setMetricConfig('ram_usage', { enabled: false })
  assert.equal(find('ram_usage').status, 'off')
  assert.equal(host.readMetrics().status, 'ok') // RAM no longer counted
  host.setMetricConfig('ram_usage', { enabled: true })
})
