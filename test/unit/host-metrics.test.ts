import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as H from '../../lib/host-metrics.ts'

test('parseStat + cpuUsagePct', () => {
  const a = H.parseStat('cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 ...\n')
  assert.equal(a.total, 1000) // 100+0+100+700+100
  assert.equal(a.idle, 800) // idle 700 + iowait 100
  const b = H.parseStat('cpu  150 0 150 800 100 0 0 0 0 0\n') // total 1200, idle 900
  assert.equal(H.cpuUsagePct(a, b), 50) // (200 total − 100 idle)/200
  assert.equal(H.cpuUsagePct(a, a), null) // no delta
})

test('parseLoadavg + parseCpuCount', () => {
  assert.equal(H.parseLoadavg('0.50 0.40 0.30 1/200 123'), 0.5)
  assert.equal(H.parseCpuCount('processor\t: 0\nprocessor\t: 1\n'), 2)
  assert.equal(H.parseCpuCount(''), 1)
})

test('meminfo / ram / swap', () => {
  const m = H.parseMeminfo('MemTotal: 1000 kB\nMemAvailable: 250 kB\nSwapTotal: 0 kB\n')
  assert.equal(H.ramUsagePct(m), 75)
  assert.equal(H.swapUsagePct(m), null) // no swap configured
  const m2 = H.parseMeminfo('SwapTotal: 100 kB\nSwapFree: 40 kB\n')
  assert.equal(H.swapUsagePct(m2), 60)
})

test('uptime / kernel / file-nr / thermal', () => {
  assert.equal(H.formatUptime(90061), '1d 1h 1m')
  assert.equal(H.formatUptime(125), '2m')
  assert.equal(H.parseKernel('Linux version 6.1.0-test (a@b) gcc'), '6.1.0-test')
  const fr = H.parseFileNr('1024\t0\t100000')
  assert.deepEqual(fr, { allocated: 1024, max: 100000 })
  assert.equal(H.fileDescPct(fr), 1.024)
  assert.equal(H.parseThermal('45000'), 45)
})

test('thresholdStatus + worstStatus', () => {
  assert.equal(H.thresholdStatus(95, 80, 90), 'crit')
  assert.equal(H.thresholdStatus(85, 80, 90), 'warn')
  assert.equal(H.thresholdStatus(50, 80, 90), 'ok')
  assert.equal(H.thresholdStatus(80, 80, 90), 'ok') // not strictly greater
  assert.equal(H.worstStatus(['ok', 'warn', 'ok']), 'warn')
  assert.equal(H.worstStatus(['ok', 'crit', 'warn']), 'crit')
  assert.equal(H.worstStatus(['ok', 'ok']), 'ok')
})
