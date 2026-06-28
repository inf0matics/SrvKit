import { readFileSync, existsSync, readdirSync, statfsSync } from 'node:fs'
import { join } from 'node:path'
import { store } from './srvkit.ts'
import * as H from '../../lib/host-metrics.ts'

// Host filesystem mounted read-only into the container. Overridable for tests.
const hostProc = () => process.env.HOST_PROC || '/host/proc'
const hostSys = () => process.env.HOST_SYS || '/host/sys'
const hostRoot = () => process.env.HOST_ROOT || '/host/root'
const hostMtab = () => process.env.HOST_MTAB || '/host/etc/mtab'

function readFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

// --- Required mounts ---
export interface MountInfo {
  path: string
  present: boolean
  compose: string
  /** Category section the warning is shown under when this mount is missing. */
  section: string
  /** Optional mounts (host root) enable extra metrics but aren't required. */
  optional: boolean
}

export function mounts(): MountInfo[] {
  return [
    {
      path: hostProc(),
      present: existsSync(hostProc()),
      compose: '- /proc:/host/proc:ro',
      section: 'CPU',
      optional: false,
    },
    {
      path: hostSys(),
      present: existsSync(hostSys()),
      compose: '- /sys:/host/sys:ro',
      section: 'CPU',
      optional: false,
    },
    {
      // Whole host filesystem — broad exposure, only needed for disk usage.
      path: hostRoot(),
      present: existsSync(hostRoot()),
      compose: '- /:/host/root:ro',
      section: 'Disk',
      optional: true,
    },
  ]
}

// --- Per-metric config (enable + thresholds), persisted as one JSON blob ---
interface Override {
  enabled?: boolean
  warn?: number
  crit?: number
}

function loadConfig(): Record<string, Override> {
  try {
    return JSON.parse(store().getConfig('host_metric_cfg') || '{}') as Record<string, Override>
  } catch {
    return {}
  }
}

export function setMetricConfig(id: string, patch: Override): void {
  const cfg = loadConfig()
  cfg[id] = { ...cfg[id], ...patch }
  store().setConfig('host_metric_cfg', JSON.stringify(cfg))
}

// --- Metric output ---
export type MetricStatus = 'ok' | 'warn' | 'crit' | 'na' | 'info' | 'off'

export interface Metric {
  id: string
  name: string
  category: string
  value: number | null
  display: string
  unit: string
  warn: number | null
  crit: number | null
  /** 'high' = higher is worse (default); 'low' = lower is worse (e.g. inodes). */
  dir: 'high' | 'low'
  status: MetricStatus
  enabled: boolean
  informational: boolean
  note?: string
}

// Rolling samples for rate/delta metrics (CPU, disk I/O, net throughput).
let prevCpu: H.CpuTimes | null = null
interface IoSample {
  time: number
  diskBytes: number
  net: Record<string, number>
}
let prevIo: IoSample | null = null

function sampleIo(): IoSample {
  const ds = H.parseDiskstats(readFile(join(hostProc(), 'diskstats')) ?? '')
  const nd = H.parseNetDev(readFile(join(hostProc(), 'net/dev')) ?? '')
  const net: Record<string, number> = {}
  for (const n of nd) net[n.iface] = n.rxBytes + n.txBytes
  return { time: Date.now(), diskBytes: H.diskstatsBytes(ds), net }
}

/** Take initial samples so the first read can already report rates. */
export function primeHost(): void {
  const stat = readFile(join(hostProc(), 'stat'))
  if (stat) prevCpu = H.parseStat(stat)
  prevIo = sampleIo()
}

function cpuTemp(): number | null {
  const dir = join(hostSys(), 'class/thermal')
  if (!existsSync(dir)) return null
  try {
    for (const zone of readdirSync(dir)) {
      if (!zone.startsWith('thermal_zone')) continue
      const t = readFile(join(dir, zone, 'temp'))
      if (t) return H.parseThermal(t)
    }
  } catch {
    /* unreadable */
  }
  return null
}

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v)}%`)

function slug(mountpoint: string): string {
  if (mountpoint === '/') return 'root'
  return mountpoint.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '_') || 'root'
}

/** Read all host metrics + the worst-of aggregate status. */
export function readMetrics(): { metrics: Metric[]; status: MetricStatus } {
  const cfg = loadConfig()

  function threshold(o: {
    id: string
    name: string
    category: string
    value: number | null
    display: string
    unit: string
    defWarn: number
    defCrit: number
    dir?: 'high' | 'low'
    note?: string
  }): Metric {
    const ov = cfg[o.id] ?? {}
    const enabled = ov.enabled !== false
    const warn = ov.warn ?? o.defWarn
    const crit = ov.crit ?? o.defCrit
    const dir = o.dir ?? 'high'
    let status: MetricStatus
    if (!enabled) status = 'off'
    else if (o.value === null) status = o.note ? 'ok' : 'na'
    else
      status =
        dir === 'low'
          ? H.thresholdStatusLow(o.value, warn, crit)
          : H.thresholdStatus(o.value, warn, crit)
    return {
      id: o.id,
      name: o.name,
      category: o.category,
      value: o.value,
      display: o.display,
      unit: o.unit,
      warn,
      crit,
      dir,
      status,
      enabled,
      informational: false,
      note: o.note,
    }
  }

  const info = (id: string, name: string, category: string, display: string): Metric => ({
    id,
    name,
    category,
    value: null,
    display,
    unit: '',
    warn: null,
    crit: null,
    dir: 'high',
    status: 'info',
    enabled: true,
    informational: true,
  })

  const out: Metric[] = []

  // --- CPU ---
  const cpuinfo = readFile(join(hostProc(), 'cpuinfo')) ?? ''
  const cores = H.parseCpuCount(cpuinfo)
  const statContent = readFile(join(hostProc(), 'stat'))
  let cpuPct: number | null = null
  if (statContent) {
    const cur = H.parseStat(statContent)
    if (prevCpu) cpuPct = H.cpuUsagePct(prevCpu, cur)
    prevCpu = cur
  }
  out.push(
    threshold({
      id: 'cpu_util',
      name: 'CPU utilization',
      category: 'CPU',
      value: cpuPct,
      display: pct(cpuPct),
      unit: '%',
      defWarn: 80,
      defCrit: 90,
    }),
  )
  const load = statContent ? H.parseLoadavg(readFile(join(hostProc(), 'loadavg')) ?? '0') : null
  out.push(
    threshold({
      id: 'load_avg',
      name: 'Load average',
      category: 'CPU',
      value: load,
      display: load === null ? '—' : load.toFixed(2),
      unit: '',
      defWarn: cores,
      defCrit: cores * 2,
    }),
  )
  const temp = cpuTemp()
  out.push(
    threshold({
      id: 'cpu_temp',
      name: 'CPU temperature',
      category: 'CPU',
      value: temp,
      display: temp === null ? 'not available' : `${Math.round(temp)}°C`,
      unit: '°C',
      defWarn: 70,
      defCrit: 80,
    }),
  )

  // --- Memory ---
  const meminfo = H.parseMeminfo(readFile(join(hostProc(), 'meminfo')) ?? '')
  out.push(
    threshold({
      id: 'ram_usage',
      name: 'RAM usage',
      category: 'Memory',
      value: H.ramUsagePct(meminfo),
      display: pct(H.ramUsagePct(meminfo)),
      unit: '%',
      defWarn: 80,
      defCrit: 90,
    }),
  )
  const swap = H.swapUsagePct(meminfo)
  out.push(
    threshold({
      id: 'swap_usage',
      name: 'Swap usage',
      category: 'Memory',
      value: swap,
      display: swap === null ? '—' : pct(swap),
      unit: '%',
      defWarn: 20,
      defCrit: 50,
      note: meminfo.SwapTotal === 0 ? 'no swap configured' : undefined,
    }),
  )

  // --- Disk (needs the host root mounted for statfs) ---
  const cur = sampleIo()
  const elapsed = prevIo ? (cur.time - prevIo.time) / 1000 : 0

  if (existsSync(hostRoot())) {
    const table = readFile(hostMtab()) ?? readFile(join(hostProc(), 'mounts')) ?? ''
    for (const m of H.parseMtab(table)) {
      let usage: number | null = null
      let inodes: number | null = null
      try {
        const s = statfsSync(join(hostRoot(), m.mountpoint))
        const used = s.blocks - s.bfree
        const avail = s.bavail
        if (used + avail > 0) usage = (used / (used + avail)) * 100
        if (s.files > 0) inodes = (s.ffree / s.files) * 100
      } catch {
        /* mountpoint not reachable under host root */
      }
      out.push(
        threshold({
          id: `disk_${slug(m.mountpoint)}`,
          name: `Disk usage (${m.mountpoint})`,
          category: 'Disk',
          value: usage,
          display: pct(usage),
          unit: '%',
          defWarn: 80,
          defCrit: 90,
        }),
      )
      out.push(
        threshold({
          id: `inode_${slug(m.mountpoint)}`,
          name: `Inodes free (${m.mountpoint})`,
          category: 'Disk',
          value: inodes,
          display: pct(inodes),
          unit: '%',
          defWarn: 10,
          defCrit: 5,
          dir: 'low',
        }),
      )
    }
  }
  // Disk I/O throughput (informational; thresholds disabled in v1).
  const ioRate = prevIo && elapsed > 0 ? (cur.diskBytes - prevIo.diskBytes) / elapsed : null
  out.push(info('disk_io', 'Disk I/O', 'Disk', ioRate === null ? '—' : H.formatRate(ioRate)))

  // --- Network (per interface, loopback excluded) ---
  const ifaces = H.parseNetDev(readFile(join(hostProc(), 'net/dev')) ?? '').filter(
    (n) => n.iface !== 'lo',
  )
  for (const n of ifaces) {
    out.push(
      threshold({
        id: `net_err_${n.iface}`,
        name: `Error rate (${n.iface})`,
        category: 'Network',
        value: H.errorRatePct(n),
        display: `${H.errorRatePct(n).toFixed(2)}%`,
        unit: '%',
        defWarn: 1,
        defCrit: 5,
      }),
    )
    const bytes = n.rxBytes + n.txBytes
    const prev = prevIo?.net[n.iface]
    const rate = prev !== undefined && elapsed > 0 ? (bytes - prev) / elapsed : null
    out.push(
      info(
        `net_tp_${n.iface}`,
        `Throughput (${n.iface})`,
        'Network',
        rate === null ? '—' : H.formatRate(rate),
      ),
    )
  }
  prevIo = cur

  // --- System info ---
  const uptime = readFile(join(hostProc(), 'uptime'))
  out.push(info('uptime', 'Uptime', 'System', uptime ? H.formatUptime(H.parseUptime(uptime)) : '—'))
  const version = readFile(join(hostProc(), 'version'))
  out.push(info('kernel', 'Kernel version', 'System', version ? H.parseKernel(version) : '—'))
  const fr = H.parseFileNr(readFile(join(hostProc(), 'sys/fs/file-nr')) ?? '')
  const fd = H.fileDescPct(fr)
  out.push(
    threshold({
      id: 'fd_usage',
      name: 'Open file descriptors',
      category: 'System',
      value: fd,
      display: pct(fd),
      unit: '%',
      defWarn: 80,
      defCrit: 90,
    }),
  )

  const rated = out
    .filter((m) => m.status === 'ok' || m.status === 'warn' || m.status === 'crit')
    .map((m) => m.status as H.Status)
  return { metrics: out, status: rated.length ? H.worstStatus(rated) : 'ok' }
}
