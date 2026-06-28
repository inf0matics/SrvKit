// Pure parsers for Linux /proc + /sys files, plus threshold helpers. Everything
// here takes file *contents* (strings) so it's testable without a real host.

export type Status = 'ok' | 'warn' | 'crit'

export interface CpuTimes {
  total: number
  idle: number
}

/** Parse the aggregate `cpu` line of /proc/stat into total + idle jiffies. */
export function parseStat(content: string): CpuTimes {
  const line = content.split('\n').find((l) => l.startsWith('cpu '))
  if (!line) return { total: 0, idle: 0 }
  const nums = line.trim().split(/\s+/).slice(1).map(Number)
  const idle = (nums[3] ?? 0) + (nums[4] ?? 0) // idle + iowait
  const total = nums.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
  return { total, idle }
}

/** CPU utilization % between two /proc/stat samples; null if the delta is empty. */
export function cpuUsagePct(prev: CpuTimes, cur: CpuTimes): number | null {
  const dt = cur.total - prev.total
  const di = cur.idle - prev.idle
  if (dt <= 0) return null
  return Math.max(0, Math.min(100, ((dt - di) / dt) * 100))
}

/** First value of /proc/loadavg (1-minute load average). */
export function parseLoadavg(content: string): number {
  return Number(content.trim().split(/\s+/)[0] ?? 0)
}

/** Number of CPUs from /proc/cpuinfo ("processor :" lines), at least 1. */
export function parseCpuCount(cpuinfo: string): number {
  const n = (cpuinfo.match(/^processor\s*:/gm) || []).length
  return n > 0 ? n : 1
}

/** /proc/meminfo into a { Key: kB } map. */
export function parseMeminfo(content: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of content.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)/)
    if (m) out[m[1]!] = Number(m[2])
  }
  return out
}

export function ramUsagePct(mem: Record<string, number>): number | null {
  const total = mem.MemTotal
  if (!total) return null
  const avail =
    mem.MemAvailable ?? (mem.MemFree ?? 0) + (mem.Buffers ?? 0) + (mem.Cached ?? 0)
  return ((total - avail) / total) * 100
}

/** Swap usage %, or null when no swap is configured (SwapTotal = 0). */
export function swapUsagePct(mem: Record<string, number>): number | null {
  const total = mem.SwapTotal
  if (!total) return null
  return ((total - (mem.SwapFree ?? 0)) / total) * 100
}

export function parseUptime(content: string): number {
  return Number(content.trim().split(/\s+/)[0] ?? 0)
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (d) parts.push(`${d}d`)
  if (d || h) parts.push(`${h}h`)
  parts.push(`${m}m`)
  return parts.join(' ')
}

/** Kernel release from /proc/version ("Linux version 6.1.0-… (…)"). */
export function parseKernel(content: string): string {
  const m = content.match(/Linux version (\S+)/)
  return m ? m[1]! : content.trim().split(/\s+/).slice(0, 3).join(' ')
}

/** /proc/sys/fs/file-nr → { allocated, max }. */
export function parseFileNr(content: string): { allocated: number; max: number } {
  const [allocated, , max] = content.trim().split(/\s+/).map(Number)
  return { allocated: allocated ?? 0, max: max ?? 0 }
}

export function fileDescPct(fr: { allocated: number; max: number }): number | null {
  return fr.max > 0 ? (fr.allocated / fr.max) * 100 : null
}

/** Millidegrees (e.g. /sys/class/thermal/.../temp) → °C. */
export function parseThermal(milli: string): number {
  return Number(milli.trim()) / 1000
}

/** OK/WARN/CRIT for a higher-is-worse value against warn/crit thresholds. */
export function thresholdStatus(value: number, warn: number, crit: number): Status {
  if (value > crit) return 'crit'
  if (value > warn) return 'warn'
  return 'ok'
}

/** Worst of a set of statuses (crit > warn > ok). */
export function worstStatus(statuses: Status[]): Status {
  if (statuses.includes('crit')) return 'crit'
  if (statuses.includes('warn')) return 'warn'
  return 'ok'
}
