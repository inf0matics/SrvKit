import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Configure the environment before importing modules that read it.
const base = mkdtempSync(join(tmpdir(), 'srvkit-host-'))
const proc = join(base, 'proc')
const sys = join(base, 'sys')
const root = join(base, 'root')
const mtab = join(base, 'mtab')
process.env.DATABASE_PATH = join(base, 'db.sqlite')
process.env.ENCRYPTION_KEY = 'host-test-key'
process.env.HOST_PROC = proc
process.env.HOST_SYS = sys
process.env.HOST_ROOT = root
process.env.HOST_MTAB = mtab

mkdirSync(join(proc, 'sys', 'fs'), { recursive: true })
mkdirSync(join(proc, 'net'), { recursive: true })
mkdirSync(sys, { recursive: true })
mkdirSync(root, { recursive: true })
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
writeFileSync(join(proc, 'diskstats'), '   8       0 sda 1000 0 8000 100 500 0 16000 200 0 50 300\n')
writeFileSync(
  join(proc, 'net', 'dev'),
  'h\nh\n    lo:  100 10 0 0 0 0 0 0 100 10 0 0\n  eth0: 5000 1000 0 0 0 0 0 0 3000 800 0 0\n',
)
writeFileSync(mtab, '/dev/sda1 / ext4 rw 0 0\ntmpfs /run tmpfs rw 0 0\n')

const host = await import('../../server/utils/host.ts')
const { store } = await import('../../server/utils/srvkit.ts')

const find = (id: string) => host.readMetrics().metrics.find((m) => m.id === id)!
// Advance the consecutive-poll counters n times (a "poll").
const poll = (n = 1) => {
  for (let i = 0; i < n; i++) host.readMetrics(true)
}

after(() => {
  store().close()
  rmSync(base, { recursive: true, force: true })
})

test('mounts are detected as present', () => {
  assert.ok(host.mounts().every((m) => m.present))
})

test('RAM over threshold is PENDING until N consecutive polls, then WARN', () => {
  host.resetCounters()
  poll(1)
  const pending = find('ram_usage')
  assert.equal(pending.display, '85%')
  assert.equal(pending.status, 'pending')
  assert.equal(pending.pendingLevel, 'warn')
  assert.equal(pending.pollCount, 1)
  assert.equal(pending.polls, 3) // default

  poll(2) // reach 3 consecutive
  assert.equal(find('ram_usage').status, 'warn')

  // Aggregate now reflects WARN (exclude the machine-dependent disk metric).
  host.setMetricConfig('disk_root', { enabled: false })
  assert.equal(host.readMetrics().status, 'warn')
  host.setMetricConfig('disk_root', { enabled: true })
})

test('recovery is immediate — back under threshold flips to OK at once', () => {
  host.resetCounters()
  poll(3) // RAM → WARN
  assert.equal(find('ram_usage').status, 'warn')
  host.setMetricConfig('ram_usage', { warn: 90, crit: 95 }) // now 85 < 90
  assert.equal(find('ram_usage').status, 'ok') // immediate, no poll needed
  host.setMetricConfig('ram_usage', { warn: 80, crit: 90 })
})

test('a lower consecutive-polls setting flips sooner', () => {
  host.resetCounters()
  host.setMetricConfig('ram_usage', { polls: 1 })
  poll(1)
  assert.equal(find('ram_usage').status, 'warn') // 1 of 1
  host.setMetricConfig('ram_usage', { polls: 3 })
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

test('disk usage + inode rows are built per partition (statfs via host root)', () => {
  const disk = find('disk_root')
  assert.equal(disk.category, 'Disk')
  assert.match(disk.display, /^\d+%$/) // statfs of the test machine
  const inode = find('inode_root')
  assert.equal(inode.dir, 'low') // inodes free → lower is worse
  assert.equal(inode.warn, 10)
})

test('network error rate per interface, loopback excluded', () => {
  assert.equal(find('net_err_eth0').status, 'ok') // 0 errors in the fixture
  assert.equal(find('net_err_eth0').display, '0.00%')
  assert.equal(host.readMetrics().metrics.some((m) => m.id === 'net_err_lo'), false)
})

test('threshold override changes the status', () => {
  host.setMetricConfig('ram_usage', { warn: 90, crit: 95 })
  assert.equal(find('ram_usage').status, 'ok') // 85 < 90
  host.setMetricConfig('ram_usage', { warn: 80, crit: 90 }) // restore
})

test('disabling a metric marks it off and drops it from the aggregate', () => {
  host.setMetricConfig('disk_root', { enabled: false }) // machine-dependent
  host.setMetricConfig('ram_usage', { enabled: false })
  assert.equal(find('ram_usage').status, 'off')
  assert.equal(host.readMetrics().status, 'ok') // RAM no longer counted
  host.setMetricConfig('ram_usage', { enabled: true })
  host.setMetricConfig('disk_root', { enabled: true })
})
