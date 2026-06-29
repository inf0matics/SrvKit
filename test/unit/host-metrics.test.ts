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

test('thresholdStatusLow (lower-is-worse, e.g. inodes remaining)', () => {
  assert.equal(H.thresholdStatusLow(3, 10, 5), 'crit') // <5
  assert.equal(H.thresholdStatusLow(8, 10, 5), 'warn') // <10
  assert.equal(H.thresholdStatusLow(50, 10, 5), 'ok')
})

test('parseMtab keeps real disk filesystems only', () => {
  const m = H.parseMtab(
    '/dev/sda1 / ext4 rw 0 0\ntmpfs /run tmpfs rw 0 0\n/dev/sdb1 /data\\040dir xfs rw 0 0\nproc /proc proc rw 0 0\n',
  )
  assert.deepEqual(
    m.map((e) => `${e.mountpoint}:${e.fstype}`),
    ['/:ext4', '/data dir:xfs'], // tmpfs/proc excluded, octal-escape decoded
  )
})

test('parseMtab drops overlay/virtual fs and Docker/runtime paths (spec 12.03)', () => {
  const m = H.parseMtab(
    [
      '/dev/sda1 / ext4 rw 0 0',
      '/dev/sda2 /boot ext4 rw 0 0',
      'overlay /var/lib/docker/overlay2/abc/merged overlay rw 0 0',
      '/dev/sda1 /host/root/var/lib/docker/containers/x ext4 rw 0 0', // ext4 but docker path
      'cgroup2 /sys/fs/cgroup cgroup2 rw 0 0',
      'devtmpfs /dev devtmpfs rw 0 0',
      '/dev/sda1 /dev/shm ext4 rw 0 0', // ext4 but under /dev/
      'efivarfs /sys/firmware/efi/efivars efivarfs rw 0 0',
    ].join('\n'),
  )
  assert.deepEqual(
    m.map((e) => e.mountpoint),
    ['/', '/boot'],
  )
})

test('parseNetDev + errorRatePct', () => {
  const dev = H.parseNetDev(
    'Inter-|   Receive\n face |bytes\n    lo:  100 10 0 0 0 0 0 0  100 10 0 0\n  eth0: 5000 1000 5 0 0 0 0 0 6000 1000 5 0\n',
  )
  const eth0 = dev.find((d) => d.iface === 'eth0')!
  assert.equal(eth0.rxPackets, 1000)
  assert.equal(eth0.txErrs, 5)
  // (5 + 5) errs / (1000 + 1000) packets = 0.5%
  assert.equal(H.errorRatePct(eth0), 0.5)
  assert.equal(H.errorRatePct({ ...eth0, rxPackets: 0, txPackets: 0 }), 0)
})

test('parseDiskstats (whole disks) + bytes + formatRate', () => {
  const s = H.parseDiskstats(
    '   8       0 sda 100 0 200 0 50 0 400 0 0 0 0\n   8       1 sda1 1 0 2 0 1 0 4 0 0 0 0\n   7       0 loop0 1 0 1 0 1 0 1 0 0 0 0\n',
  )
  assert.deepEqual(
    s.map((d) => d.dev),
    ['sda'], // sda1 partition + loop excluded
  )
  assert.equal(H.diskstatsBytes(s), (200 + 400) * 512)
  assert.equal(H.formatRate(0), '0 B/s')
  assert.equal(H.formatRate(1536), '1.5 KB/s')
})
