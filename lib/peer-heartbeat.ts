import { randomBytes } from 'node:crypto'

// Pure heartbeat helpers (no DB / no network) so they're unit-testable.

/** Heartbeat cadence shipped by v1 — still the default, so nothing changes untuned. */
export const DEFAULT_PING_INTERVAL_SEC = 300
/** Consecutive missed heartbeats before the receiver alerts. */
export const DEFAULT_MISS_THRESHOLD = 2
/** Watchdog cadence, and the grace added to every silence window. */
export const WATCHDOG_TICK_MS = 60 * 1000
/** Bounds for a configured send interval (seconds). */
export const MIN_PING_INTERVAL_SEC = 30
export const MAX_PING_INTERVAL_SEC = 3600
/** Bounds for the configured miss threshold. */
export const MIN_MISS_THRESHOLD = 1
export const MAX_MISS_THRESHOLD = 10
export const PAIRING_KEY_TTL_MS = 10 * 60 * 1000

export type PeerStatus = 'ok' | 'crit'

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous 0/O/1/I

/** 8-char alphanumeric pairing key, displayed grouped as `XXXX-XXXX`. */
export function generatePairingKey(): string {
  const bytes = randomBytes(8)
  let k = ''
  for (let i = 0; i < 8; i++) k += KEY_ALPHABET[bytes[i]! % KEY_ALPHABET.length]
  return k
}

/** A long random bearer token a peer presents on every ping. */
export function generatePeerToken(): string {
  return randomBytes(32).toString('hex')
}

/** Normalise a user-entered key for comparison (strip spaces/dashes, upper-case). */
export function normalizeKey(key: string): string {
  return key.replace(/[\s-]/g, '').toUpperCase()
}

/** Group a key for display: `A3F7KP92` → `A3F7-KP92`. */
export function formatKey(key: string): string {
  const k = normalizeKey(key)
  return k.length === 8 ? `${k.slice(0, 4)}-${k.slice(4)}` : k
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** Send interval in seconds, clamped to a range that still makes sense to poll. */
export function normalizePingInterval(sec: unknown): number {
  return clampInt(
    sec === '' || sec === null ? undefined : sec,
    MIN_PING_INTERVAL_SEC,
    MAX_PING_INTERVAL_SEC,
    DEFAULT_PING_INTERVAL_SEC,
  )
}

/** How many consecutive heartbeats may go missing before we alert. */
export function normalizeMissThreshold(n: unknown): number {
  return clampInt(
    n === '' || n === null ? undefined : n,
    MIN_MISS_THRESHOLD,
    MAX_MISS_THRESHOLD,
    DEFAULT_MISS_THRESHOLD,
  )
}

/**
 * Silence a peer is allowed before it counts as CRIT: the missed heartbeats the
 * threshold permits, plus one watchdog tick of grace. Without that grace a
 * heartbeat arriving a few seconds late lands in the next tick as a miss —
 * which is how v1 (window === interval, no grace) turned a one-second DNS
 * hiccup at the hoster into a page.
 */
export function silenceWindowMs(intervalSec: number, threshold: number): number {
  return intervalSec * 1000 * threshold + WATCHDOG_TICK_MS
}

/** The window applied to a peer that reports no interval of its own. */
export const DEFAULT_SILENCE_WINDOW_MS = silenceWindowMs(
  DEFAULT_PING_INTERVAL_SEC,
  DEFAULT_MISS_THRESHOLD,
)

/** CRIT once a peer has been silent beyond the window, else OK. */
export function peerStatus(
  lastSeenMs: number,
  nowMs: number,
  windowMs = DEFAULT_SILENCE_WINDOW_MS,
): PeerStatus {
  return nowMs - lastSeenMs > windowMs ? 'crit' : 'ok'
}

/** Short tag shared by an alert and its recovery, for channels without replies. */
export function generateIncidentRef(): string {
  return randomBytes(3).toString('hex')
}

/** Coarse duration for message text: minutes, then hours + minutes. */
export function formatSilence(ms: number): string {
  const minutes = Math.max(1, Math.round(Math.max(0, ms) / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/** Interval as the message should read it: whole minutes where it divides. */
export function formatInterval(sec: number): string {
  return sec % 60 === 0 ? `${sec / 60} min` : `${sec} s`
}

/** `2026-11-06 20:04 UTC` — unambiguous without assuming the reader's zone. */
export function formatTimestamp(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** Why one heartbeat attempt did not land, as the sender saw it. */
export type SendFailureReason = 'dns' | 'refused' | 'timeout' | 'tls' | 'http' | 'unreachable'

export interface SendFailure {
  /** ISO timestamp of the attempt. */
  at: string
  reason: SendFailureReason
  /** One line a human can act on, naming the host. */
  detail: string
}

/** Attempts kept in the journal — enough to explain a gap, bounded for the kv row. */
export const MAX_JOURNAL_ENTRIES = 10

/**
 * Turn a thrown `fetch` error into a cause worth sending. `fetch` wraps network
 * failures in a TypeError and puts the detail on `cause.code`, which is the
 * only place a DNS outage is distinguishable from a dead host.
 */
export function classifySendError(err: unknown, host: string): Omit<SendFailure, 'at'> {
  const name = (err as Error)?.name
  const code = String(((err as { cause?: { code?: unknown } })?.cause?.code ?? '') || '')

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { reason: 'dns', detail: `DNS lookup failed for ${host}` }
  }
  if (code === 'ECONNREFUSED') {
    return { reason: 'refused', detail: `Connection refused by ${host}` }
  }
  if (name === 'TimeoutError' || name === 'AbortError') {
    return { reason: 'timeout', detail: `No response from ${host} within 8s` }
  }
  if (code.startsWith('CERT_') || code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL')) {
    return { reason: 'tls', detail: `TLS error talking to ${host} (${code})` }
  }
  return { reason: 'unreachable', detail: `Could not reach ${host}${code ? ` (${code})` : ''}` }
}

/** A non-2xx answer is its own cause: the peer is up but refused the heartbeat. */
export function classifyHttpStatus(status: number, host: string): Omit<SendFailure, 'at'> {
  // 401/403 mean the token or the IP allowlist, not the network — say so.
  const hint = status === 401 || status === 403 ? ' — re-pair this peer' : ''
  return { reason: 'http', detail: `${host} answered HTTP ${status}${hint}` }
}

/** Append an attempt, dropping the oldest once the journal is full. */
export function appendFailure(journal: SendFailure[], entry: SendFailure): SendFailure[] {
  return [...journal, entry].slice(-MAX_JOURNAL_ENTRIES)
}

/** `20:09` — the time of day is what makes a list of attempts readable. */
function clockTime(iso: string): string {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, 16) : iso
}

/**
 * One line per distinct cause, each with the times it happened — three DNS
 * failures are one problem, not three, but a DNS failure followed by a timeout
 * is two different stories.
 */
export function summarizeFailures(misses: SendFailure[]): string {
  if (!misses.length) return ''
  const byDetail = new Map<string, string[]>()
  for (const m of misses) {
    const times = byDetail.get(m.detail) ?? []
    times.push(clockTime(m.at))
    byDetail.set(m.detail, times)
  }
  const attempts = `${misses.length} attempt${misses.length === 1 ? '' : 's'} failed`
  const causes = [...byDetail].map(([detail, times]) => `${detail} (${times.join(', ')})`)
  return `${attempts}: ${causes.join('; ')}.`
}

export interface PeerSilentContext {
  name: string
  /** Interval this peer reports (or the configured default). */
  intervalSec: number
  lastSeenMs: number
  nowMs: number
  threshold: number
  ref: string | null
}

const refTag = (ref: string | null) => (ref ? ` [#${ref}]` : '')

/**
 * What the receiver can state by itself: how many intervals went missing, when
 * the last heartbeat landed, and the reference its recovery will carry. The
 * cause of the silence is the sender's to report (spec 21).
 */
export function buildPeerSilentMessage(prefix: string, ctx: PeerSilentContext): string {
  const silentMs = ctx.nowMs - ctx.lastSeenMs
  const missed = Math.max(ctx.threshold, Math.floor(silentMs / (ctx.intervalSec * 1000)))
  return (
    `⚠️ ${prefix} ${ctx.name} has not reported in — ${missed} missed heartbeats ` +
    `(every ${formatInterval(ctx.intervalSec)}).\n` +
    `Last heartbeat: ${formatTimestamp(ctx.lastSeenMs)} (${formatSilence(silentMs)} ago).` +
    refTag(ctx.ref)
  )
}

/**
 * The recovery is where the cause finally lands: only the sender knows why its
 * heartbeats did not arrive, and it can only tell us once one does. Without a
 * report — a peer that was genuinely down, or runs an older build — say that
 * rather than implying the network was fine.
 */
export function buildPeerRecoveredMessage(
  prefix: string,
  ctx: { name: string; silentMs: number; ref: string | null; misses?: SendFailure[] },
): string {
  const head =
    `✅ ${prefix} ${ctx.name} is back online — silent for ${formatSilence(ctx.silentMs)}.` +
    refTag(ctx.ref)
  if (ctx.misses === undefined) return head
  const causes = summarizeFailures(ctx.misses)
  return `${head}\n${causes || 'Cause not reported by the peer.'}`
}

/** Aggregate for the sidebar badge: crit if any peer is silent, else ok. */
export function worstPeerStatus(statuses: PeerStatus[]): PeerStatus {
  return statuses.includes('crit') ? 'crit' : 'ok'
}

/** Validate a peer domain — must be a well-formed http(s) origin. */
export function normalizeDomain(input: string): string | null {
  try {
    const u = new URL(input.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.origin
  } catch {
    return null
  }
}
