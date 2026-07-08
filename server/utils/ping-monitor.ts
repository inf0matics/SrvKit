import { randomUUID } from 'node:crypto'
import { store } from './srvkit.ts'
import { dispatch, messagePrefix, recoveryEnabled } from './alerts.ts'
import {
  normalizeInterval,
  normalizeExpectedStatus,
  pingStatus,
  worstPingStatus,
  PING_TIMEOUT_MS,
  MAX_REDIRECTS,
  type PingStatus,
} from '../../lib/ping-monitor.ts'

// Ping definitions live as a JSON array in the `config` kv table (same pattern
// as docker_container_cfg). Runtime check results are in-memory only — rebuilt
// on the next poll after a restart, so nothing about live status is persisted.
const CFG_KEY = 'pings'
export const PING_POLL_INTERVAL_SECONDS = 15

/** A user-configured ping (persisted). */
export interface PingDef {
  id: string
  url: string
  /** Optional display name; '' means fall back to the URL. */
  name: string
  expectedStatus: number
  intervalSec: number
  enabled: boolean
}

export interface PingInput {
  url: string
  name?: string
  expectedStatus?: unknown
  intervalSec?: unknown
}

export interface PingPatch {
  url?: string
  name?: string
  expectedStatus?: unknown
  intervalSec?: unknown
  enabled?: boolean
}

function loadPings(): PingDef[] {
  try {
    const arr = JSON.parse(store().getConfig(CFG_KEY) || '[]') as PingDef[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}
function savePings(pings: PingDef[]): void {
  store().setConfig(CFG_KEY, JSON.stringify(pings))
}

// --- Runtime check state (in-memory; keyed by ping id) ---
interface PingRuntime {
  lastCheckedAt: number
  lastCode: number | null
  /** Human reason when there's no code (e.g. 'timeout', 'connection failed'). */
  lastError: string | null
  status: PingStatus
  /** Alert de-dup: last level we alerted on. */
  alertState: PingStatus
  /** When the current failing streak began (null while OK). */
  failingSince: number | null
}
const runtime = new Map<string, PingRuntime>()

/** Test helper: clear all in-memory check state (simulates a restart). */
export function resetPingRuntime(): void {
  runtime.clear()
}

// --- HTTP check ---

interface FetchResponse {
  status: number
  headers: { get(name: string): string | null }
}
export type FetchLike = (
  url: string,
  init: { method: 'GET'; redirect: 'manual'; signal: AbortSignal },
) => Promise<FetchResponse>

const defaultFetch = (): FetchLike => globalThis.fetch as unknown as FetchLike

/**
 * GET the URL, following up to MAX_REDIRECTS hops manually, under a single 10s
 * budget. Returns the final status code, or a null code + reason on
 * timeout / connection failure.
 */
export async function checkUrl(
  url: string,
  fetchImpl: FetchLike = defaultFetch(),
): Promise<{ code: number | null; error: string | null }> {
  const signal = AbortSignal.timeout(PING_TIMEOUT_MS)
  try {
    let current = url
    for (let hop = 0; ; hop++) {
      const res = await fetchImpl(current, { method: 'GET', redirect: 'manual', signal })
      const location =
        res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
      if (location && hop < MAX_REDIRECTS) {
        current = new URL(location, current).toString()
        continue
      }
      return { code: res.status, error: null }
    }
  } catch (e) {
    const name = (e as Error).name
    const error = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'connection failed'
    return { code: null, error }
  }
}

// --- Alerting (state-change only, mirrors the backup/docker de-dup) ---

const labelOf = (def: PingDef) => (def.name.trim() ? def.name.trim() : def.url)

function buildFailedMessage(
  prefix: string,
  def: PingDef,
  code: number | null,
  error: string | null,
): string {
  const got = code !== null ? `got ${code}` : `request ${error}`
  return `❌ ${prefix}: Ping "${labelOf(def)}" failed — ${got}, expected ${def.expectedStatus}.`
}
function buildRecoveredMessage(prefix: string, def: PingDef, code: number | null): string {
  return `✅ ${prefix}: Ping "${labelOf(def)}" recovered — ${code} OK.`
}

async function handleAlert(
  def: PingDef,
  rt: PingRuntime,
  code: number | null,
  error: string | null,
): Promise<void> {
  const prefix = messagePrefix()
  if (rt.status === 'crit' && rt.alertState === 'ok') {
    rt.alertState = 'crit'
    await dispatch(buildFailedMessage(prefix, def, code, error))
  } else if (rt.status === 'ok' && rt.alertState === 'crit') {
    rt.alertState = 'ok'
    if (recoveryEnabled()) await dispatch(buildRecoveredMessage(prefix, def, code))
  }
}

/** Check one ping, update its runtime, and (when doAlert) fire on transitions. */
async function checkOne(
  def: PingDef,
  now: number,
  doAlert: boolean,
  fetchImpl: FetchLike,
): Promise<void> {
  const { code, error } = await checkUrl(def.url, fetchImpl)
  const status = pingStatus(code, def.expectedStatus)
  const rt: PingRuntime = runtime.get(def.id) ?? {
    lastCheckedAt: now,
    lastCode: null,
    lastError: null,
    status,
    alertState: 'ok',
    failingSince: null,
  }
  rt.lastCheckedAt = now
  rt.lastCode = code
  rt.lastError = error
  rt.status = status
  rt.failingSince = status === 'crit' ? (rt.failingSince ?? now) : null
  runtime.set(def.id, rt)
  if (doAlert) await handleAlert(def, rt, code, error)
}

// --- CRUD (UI-triggered checks are silent; only the poll loop alerts) ---

/** Create a ping (enabled) and run one immediate, silent check for the UI. */
export async function createPing(
  input: PingInput,
  url: string,
  fetchImpl: FetchLike = defaultFetch(),
): Promise<PingDef> {
  const def: PingDef = {
    id: randomUUID(),
    url,
    name: (input.name ?? '').trim(),
    expectedStatus: normalizeExpectedStatus(input.expectedStatus),
    intervalSec: normalizeInterval(input.intervalSec),
    enabled: true,
  }
  const pings = loadPings()
  pings.push(def)
  savePings(pings)
  await checkOne(def, Date.now(), false, fetchImpl)
  return def
}

/**
 * Apply a patch to an existing ping. A changed URL / expected code (or an
 * enable) triggers a fresh silent check; disabling clears its runtime.
 * `url` is the already-validated value when the patch changes the URL.
 */
export async function updatePing(
  id: string,
  patch: PingPatch,
  url: string | null,
  fetchImpl: FetchLike = defaultFetch(),
): Promise<boolean> {
  const pings = loadPings()
  const def = pings.find((p) => p.id === id)
  if (!def) return false

  let recheck = false
  if (url !== null) {
    def.url = url
    recheck = true
  }
  if (typeof patch.name === 'string') def.name = patch.name.trim()
  if (patch.expectedStatus !== undefined) {
    def.expectedStatus = normalizeExpectedStatus(patch.expectedStatus)
    recheck = true
  }
  if (patch.intervalSec !== undefined) def.intervalSec = normalizeInterval(patch.intervalSec)
  if (typeof patch.enabled === 'boolean' && patch.enabled !== def.enabled) {
    def.enabled = patch.enabled
    recheck = true
  }
  savePings(pings)

  if (!def.enabled) {
    runtime.delete(id)
  } else if (recheck) {
    runtime.delete(id) // fresh baseline against the new config
    await checkOne(def, Date.now(), false, fetchImpl)
  }
  return true
}

/** Delete a ping and forget its runtime. */
export function deletePing(id: string): boolean {
  const pings = loadPings()
  const next = pings.filter((p) => p.id !== id)
  if (next.length === pings.length) return false
  savePings(next)
  runtime.delete(id)
  return true
}

// --- Poll loop + reads ---

/** Background poll: check every enabled ping that's due, fire alerts. Never throws. */
export async function pollPings(
  now = Date.now(),
  fetchImpl: FetchLike = defaultFetch(),
): Promise<void> {
  for (const def of loadPings()) {
    if (!def.enabled) continue
    const rt = runtime.get(def.id)
    const due = !rt || now - rt.lastCheckedAt >= def.intervalSec * 1000
    if (!due) continue
    try {
      await checkOne(def, now, true, fetchImpl)
    } catch (e) {
      console.error(`[pings] check failed for ${def.url}:`, (e as Error).message)
    }
  }
}

export interface PingRow extends PingDef {
  /** 'off' when disabled, 'pending' before the first check. */
  status: PingStatus | 'pending' | 'off'
  lastCode: number | null
  lastError: string | null
  /** Seconds since the last check, or null before the first one. */
  lastCheckedAgo: number | null
  /** Seconds since the failing streak began, or null while OK. */
  failingSince: number | null
}

export interface PingsData {
  pings: PingRow[]
  status: PingStatus
  anyEnabled: boolean
  pollIntervalSeconds: number
}

/** Current ping list + per-ping status + worst-of aggregate (no network). */
export function readPings(now = Date.now()): PingsData {
  const rows: PingRow[] = loadPings().map((def) => {
    const rt = runtime.get(def.id)
    let status: PingRow['status']
    if (!def.enabled) status = 'off'
    else if (!rt) status = 'pending'
    else status = rt.status
    return {
      ...def,
      status,
      lastCode: rt?.lastCode ?? null,
      lastError: rt?.lastError ?? null,
      lastCheckedAgo: rt ? Math.max(0, (now - rt.lastCheckedAt) / 1000) : null,
      failingSince: rt?.failingSince != null ? Math.max(0, (now - rt.failingSince) / 1000) : null,
    }
  })
  const statuses = rows
    .filter((r) => r.status === 'ok' || r.status === 'crit')
    .map((r) => r.status as PingStatus)
  return {
    pings: rows,
    status: worstPingStatus(statuses),
    anyEnabled: rows.some((r) => r.enabled),
    pollIntervalSeconds: PING_POLL_INTERVAL_SECONDS,
  }
}
