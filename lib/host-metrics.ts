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

/** OK/WARN/CRIT for a lower-is-worse value (e.g. inodes remaining %). */
export function thresholdStatusLow(value: number, warn: number, crit: number): Status {
  if (value < crit) return 'crit'
  if (value < warn) return 'warn'
  return 'ok'
}

// --- Disk: mount table (mtab / proc-mounts) ---
export interface MountEntry {
  device: string
  mountpoint: string
  fstype: string
}

// Pseudo / virtual / container filesystems that never represent a real host
// partition — excluded from the disk list (spec 12.03).
const EXCLUDED_FS = new Set([
  'tmpfs', 'devtmpfs', 'sysfs', 'proc', 'devpts', 'cgroup', 'cgroup2',
  'overlay', 'aufs', 'fuse.lxcfs', 'squashfs', 'nsfs', 'mqueue',
  'debugfs', 'tracefs', 'securityfs', 'pstore', 'bpf', 'hugetlbfs',
  'ramfs', 'efivarfs', 'fusectl',
])

// Mountpoints containing any of these are runtime/container internals (incl.
// duplicated host paths via /host/root/...), not real partitions.
const EXCLUDED_PATHS = ['/var/lib/docker/', '/run/docker/', '/sys/', '/proc/', '/dev/']

function unescapeMount(s: string): string {
  return s.replace(/\\(\d{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)))
}

/**
 * Parse the host mount table (/host/etc/mtab) into real partitions: drop
 * virtual filesystem types and mountpoints under Docker/runtime paths. The
 * caller still skips single-file mounts (statfs / not-a-directory).
 */
export function parseMtab(content: string): MountEntry[] {
  const out: MountEntry[] = []
  for (const line of content.split('\n')) {
    const [device, mountpoint, fstype] = line.trim().split(/\s+/)
    if (!device || !mountpoint || !fstype) continue
    if (EXCLUDED_FS.has(fstype)) continue
    const mp = unescapeMount(mountpoint)
    if (EXCLUDED_PATHS.some((p) => mp.includes(p))) continue
    out.push({ device, mountpoint: mp, fstype })
  }
  return out
}

// --- Network: /proc/net/dev ---
export interface NetIface {
  iface: string
  rxBytes: number
  rxPackets: number
  rxErrs: number
  txBytes: number
  txPackets: number
  txErrs: number
}

export function parseNetDev(content: string): NetIface[] {
  const out: NetIface[] = []
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([\w.-]+):\s*(.+)$/)
    if (!m) continue
    const f = m[2]!.trim().split(/\s+/).map(Number)
    // rx: bytes packets errs drop fifo frame compressed multicast (0..7)
    // tx: bytes packets errs (8,9,10)
    out.push({
      iface: m[1]!,
      rxBytes: f[0] ?? 0,
      rxPackets: f[1] ?? 0,
      rxErrs: f[2] ?? 0,
      txBytes: f[8] ?? 0,
      txPackets: f[9] ?? 0,
      txErrs: f[10] ?? 0,
    })
  }
  return out
}

/** Errors as a % of total packets (rx+tx); 0 when there's no traffic. */
export function errorRatePct(n: NetIface): number {
  const packets = n.rxPackets + n.txPackets
  const errs = n.rxErrs + n.txErrs
  return packets > 0 ? (errs / packets) * 100 : 0
}

// --- Disk I/O: /proc/diskstats ---
export interface DiskStat {
  dev: string
  sectorsRead: number
  sectorsWritten: number
}

// Whole block devices only (skip partitions, loop, ram, dm).
const WHOLE_DISK = /^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/

export function parseDiskstats(content: string): DiskStat[] {
  const out: DiskStat[] = []
  for (const line of content.split('\n')) {
    const f = line.trim().split(/\s+/)
    if (f.length < 14 || !WHOLE_DISK.test(f[2]!)) continue
    out.push({ dev: f[2]!, sectorsRead: Number(f[5]), sectorsWritten: Number(f[9]) })
  }
  return out
}

/** Total bytes read+written across whole disks (sectors are 512 bytes). */
export function diskstatsBytes(stats: DiskStat[]): number {
  return stats.reduce((a, s) => a + (s.sectorsRead + s.sectorsWritten) * 512, 0)
}

/** Human byte-rate, e.g. "12.3 MB/s". */
export function formatRate(bytesPerSec: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytesPerSec
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}/s`
}

/** Worst of a set of statuses (crit > warn > ok). */
export function worstStatus(statuses: Status[]): Status {
  if (statuses.includes('crit')) return 'crit'
  if (statuses.includes('warn')) return 'warn'
  return 'ok'
}
