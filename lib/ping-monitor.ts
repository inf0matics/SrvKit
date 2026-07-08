// Pure ping-monitoring logic (no store / no network) so it's unit-testable.
// Mirrors the shape of docker-monitor.ts: status mapping + worst-of aggregate.

export type PingStatus = 'ok' | 'crit'

/** Selectable poll frequencies (seconds) with their dropdown labels. */
export const FREQUENCY_OPTIONS = [
  { value: 60, label: '1 min' },
  { value: 300, label: '5 min' },
  { value: 900, label: '15 min' },
  { value: 1800, label: '30 min' },
  { value: 3600, label: '1 h' },
] as const

export const DEFAULT_INTERVAL_SEC = 300
export const DEFAULT_EXPECTED_STATUS = 200
/** Fixed request timeout in v1 — no response within this window is CRIT. */
export const PING_TIMEOUT_MS = 10_000
/** Redirects are followed up to this many hops. */
export const MAX_REDIRECTS = 5

const ALLOWED_INTERVALS = new Set<number>(FREQUENCY_OPTIONS.map((o) => o.value))

/** Snap a requested frequency to one of the allowed options (default 5 min). */
export function normalizeInterval(sec: unknown): number {
  const n = Math.round(Number(sec))
  return ALLOWED_INTERVALS.has(n) ? n : DEFAULT_INTERVAL_SEC
}

/** Clamp an expected status code to a valid HTTP range (default 200). */
export function normalizeExpectedStatus(code: unknown): number {
  const n = Math.round(Number(code))
  return Number.isFinite(n) && n >= 100 && n <= 599 ? n : DEFAULT_EXPECTED_STATUS
}

/** Validate + normalise a ping URL — must be a well-formed http(s) URL. */
export function normalizeUrl(input: string): string | null {
  try {
    const u = new URL(String(input).trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}

/** OK only when the endpoint answered with exactly the expected status code. */
export function pingStatus(actual: number | null, expected: number): PingStatus {
  return actual !== null && actual === expected ? 'ok' : 'crit'
}

/** Aggregate for the sidebar badge: crit if any enabled ping is crit, else ok. */
export function worstPingStatus(statuses: PingStatus[]): PingStatus {
  return statuses.includes('crit') ? 'crit' : 'ok'
}
