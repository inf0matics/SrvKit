import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { store } from './srvkit.ts'
import * as H from '../../lib/host-metrics.ts'

// Host filesystem mounted read-only into the container. Overridable for tests.
function hostProc(): string {
  return process.env.HOST_PROC || '/host/proc'
}
function hostSys(): string {
  return process.env.HOST_SYS || '/host/sys'
}

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
}

export function mounts(): MountInfo[] {
  return [
    { path: hostProc(), present: existsSync(hostProc()), compose: '- /proc:/host/proc:ro' },
    { path: hostSys(), present: existsSync(hostSys()), compose: '- /sys:/host/sys:ro' },
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
  status: MetricStatus
  enabled: boolean
  informational: boolean
  note?: string
}

// CPU% needs two /proc/stat samples; keep the previous one between polls.
let prevCpu: H.CpuTimes | null = null

/** Sample /proc/stat so the next readMetrics has a delta to compute CPU% from. */
export function primeCpu(): void {
  const stat = readFile(join(hostProc(), 'stat'))
  if (stat) prevCpu = H.parseStat(stat)
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

interface Built {
  id: string
  name: string
  category: string
  value: number | null
  display: string
  unit: string
  defWarn: number
  defCrit: number
  note?: string
}

/** Read all host metrics + the worst-of aggregate status. */
export function readMetrics(): { metrics: Metric[]; status: MetricStatus } {
  const cfg = loadConfig()

  const cpuinfo = readFile(join(hostProc(), 'cpuinfo')) ?? ''
  const cores = H.parseCpuCount(cpuinfo)
  const meminfo = H.parseMeminfo(readFile(join(hostProc(), 'meminfo')) ?? '')

  // CPU utilization (delta since the previous sample).
  const statContent = readFile(join(hostProc(), 'stat'))
  let cpuPct: number | null = null
  if (statContent) {
    const cur = H.parseStat(statContent)
    if (prevCpu) cpuPct = H.cpuUsagePct(prevCpu, cur)
    prevCpu = cur
  }

  const load = statContent
    ? H.parseLoadavg(readFile(join(hostProc(), 'loadavg')) ?? '0')
    : null
  const ram = H.ramUsagePct(meminfo)
  const swap = H.swapUsagePct(meminfo)
  const temp = cpuTemp()
  const fr = H.parseFileNr(readFile(join(hostProc(), 'sys/fs/file-nr')) ?? '')
  const fd = H.fileDescPct(fr)

  const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v)}%`)

  const numeric: Built[] = [
    {
      id: 'cpu_util',
      name: 'CPU utilization',
      category: 'CPU',
      value: cpuPct,
      display: pct(cpuPct),
      unit: '%',
      defWarn: 80,
      defCrit: 90,
    },
    {
      id: 'load_avg',
      name: 'Load average',
      category: 'CPU',
      value: load,
      display: load === null ? '—' : load.toFixed(2),
      unit: '',
      defWarn: cores,
      defCrit: cores * 2,
    },
    {
      id: 'cpu_temp',
      name: 'CPU temperature',
      category: 'CPU',
      value: temp,
      display: temp === null ? 'not available' : `${Math.round(temp)}°C`,
      unit: '°C',
      defWarn: 70,
      defCrit: 80,
    },
    {
      id: 'ram_usage',
      name: 'RAM usage',
      category: 'Memory',
      value: ram,
      display: pct(ram),
      unit: '%',
      defWarn: 80,
      defCrit: 90,
    },
    {
      id: 'swap_usage',
      name: 'Swap usage',
      category: 'Memory',
      value: swap,
      display: swap === null ? '—' : pct(swap),
      unit: '%',
      defWarn: 20,
      defCrit: 50,
      note: meminfo.SwapTotal === 0 ? 'no swap configured' : undefined,
    },
    {
      id: 'fd_usage',
      name: 'Open file descriptors',
      category: 'System',
      value: fd,
      display: pct(fd),
      unit: '%',
      defWarn: 80,
      defCrit: 90,
    },
  ]

  const metrics: Metric[] = numeric.map((b) => {
    const ov = cfg[b.id] ?? {}
    const enabled = ov.enabled !== false
    const warn = ov.warn ?? b.defWarn
    const crit = ov.crit ?? b.defCrit
    let status: MetricStatus
    if (!enabled) status = 'off'
    else if (b.value === null) status = b.note ? 'ok' : 'na' // no-swap = OK; else unavailable
    else status = H.thresholdStatus(b.value, warn, crit)
    return {
      id: b.id,
      name: b.name,
      category: b.category,
      value: b.value,
      display: b.display,
      unit: b.unit,
      warn,
      crit,
      status,
      enabled,
      informational: false,
      note: b.note,
    }
  })

  // Informational metrics (no thresholds).
  const uptime = readFile(join(hostProc(), 'uptime'))
  const version = readFile(join(hostProc(), 'version'))
  const info: Metric[] = [
    {
      id: 'uptime',
      name: 'Uptime',
      category: 'System',
      value: null,
      display: uptime ? H.formatUptime(H.parseUptime(uptime)) : '—',
      unit: '',
      warn: null,
      crit: null,
      status: 'info',
      enabled: true,
      informational: true,
    },
    {
      id: 'kernel',
      name: 'Kernel version',
      category: 'System',
      value: null,
      display: version ? H.parseKernel(version) : '—',
      unit: '',
      warn: null,
      crit: null,
      status: 'info',
      enabled: true,
      informational: true,
    },
  ]

  const all = [...metrics, ...info]
  const rated = all
    .filter((m) => m.status === 'ok' || m.status === 'warn' || m.status === 'crit')
    .map((m) => m.status as H.Status)
  return { metrics: all, status: rated.length ? H.worstStatus(rated) : 'ok' }
}
