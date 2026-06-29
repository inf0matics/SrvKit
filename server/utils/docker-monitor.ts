import { store } from './srvkit.ts'
import { dockerAvailable, listAllContainers, inspectContainer } from './docker.ts'
import { dispatch, messagePrefix } from './alerts.ts'
import {
  containerStatus,
  worstContainerStatus,
  type ContainerStatus,
} from '../../lib/docker-monitor.ts'

// Per-container monitoring config lives in the `config` kv table, keyed by
// container name (stable across recreate; id is not). It doubles as the registry
// of *known* containers, so runtime discovery is a diff against its keys.
// Default per container: disabled, 30s grace.
const CFG_KEY = 'docker_container_cfg'
const COUNT_KEY = 'docker_count_enabled'
const DEFAULT_GRACE = 30
const MIN_GRACE = 10
export const DOCKER_POLL_INTERVAL_SECONDS = 10

interface ContainerCfg {
  enabled?: boolean
  grace?: number
  /** True once an enabled container has vanished from Docker (kept as CRIT). */
  removed?: boolean
}

function loadCfg(): Record<string, ContainerCfg> {
  try {
    return JSON.parse(store().getConfig(CFG_KEY) || '{}') as Record<string, ContainerCfg>
  } catch {
    return {}
  }
}
function saveCfg(cfg: Record<string, ContainerCfg>): void {
  store().setConfig(CFG_KEY, JSON.stringify(cfg))
}
const enabledOf = (cfg: Record<string, ContainerCfg>, name: string) => cfg[name]?.enabled === true
const graceOf = (cfg: Record<string, ContainerCfg>, name: string) =>
  Math.max(MIN_GRACE, cfg[name]?.grace ?? DEFAULT_GRACE)

const countEnabled = () => store().getConfig(COUNT_KEY) === '1'

/** Update one container's monitoring config (enable flag and/or grace period). */
export function setContainerConfig(
  name: string,
  patch: { enabled?: boolean; grace?: number },
): void {
  const cfg = loadCfg()
  const cur = cfg[name] ?? {}
  if (typeof patch.enabled === 'boolean') cur.enabled = patch.enabled
  if (typeof patch.grace === 'number' && Number.isFinite(patch.grace)) {
    cur.grace = Math.max(MIN_GRACE, Math.round(patch.grace))
  }
  cfg[name] = cur
  saveCfg(cfg)
}

/** Forget a container entirely — used to clear a `removed` row from the list. */
export function removeContainer(name: string): void {
  const cfg = loadCfg()
  saveCfg(Object.fromEntries(Object.entries(cfg).filter(([k]) => k !== name)))
  runtime.delete(name)
}

/** Enable/disable the container-count change monitor (independent of per-container). */
export function setCountMonitor(enabled: boolean): void {
  store().setConfig(COUNT_KEY, enabled ? '1' : '0')
}

/** Enable or disable monitoring for every currently-known container. */
export async function setAllEnabled(enabled: boolean): Promise<void> {
  const cfg = loadCfg()
  for (const name of Object.keys(cfg)) cfg[name] = { ...cfg[name], enabled }
  saveCfg(cfg)
}

// --- Runtime state (in-memory; only alert de-dup, NOT the grace clock) ---
const runtime = new Map<string, { alert: 'ok' | 'warn' | 'crit' }>()
let lastRunning: number | null = null // last seen running count, for change alerts
let lastPollAt = Date.now()

/** Test helper: clear alert de-dup + count baseline (simulates a restart). */
export function resetRuntime(): void {
  runtime.clear()
  lastRunning = null
}

export interface CountSummary {
  running: number
  exited: number
  paused: number
  dead: number
}

export interface ContainerRow {
  name: string
  state: string
  status: ContainerStatus | 'off'
  pendingLevel: 'warn' | 'crit' | null
  enabled: boolean
  grace: number
  /** Seconds since the container last exited (from FinishedAt), else null. */
  offlineFor: number | null
  lastCheckedAgo: number
  /** True for a row kept around after the container was removed from Docker. */
  removed: boolean
}

/** Seconds since `finishedAt` (Docker RFC3339), or 0 if unset/never-finished. */
function elapsedFrom(finishedAt: string | null, now: number): number {
  if (!finishedAt) return 0
  const t = Date.parse(finishedAt)
  if (Number.isNaN(t) || t <= 0) return 0 // unset → "0001-01-01T00:00:00Z"
  return Math.max(0, (now - t) / 1000)
}

function buildAlert(
  prefix: string,
  name: string,
  level: 'warn' | 'crit',
  state: string,
  offlineFor: number,
): string {
  if (state === 'removed') return `❌ ${prefix}: Container "${name}" has been removed.`
  const t = Math.round(offlineFor)
  return level === 'crit'
    ? `❌ ${prefix}: Container "${name}" is down (${state}, offline for ${t}s).`
    : `⚠️ ${prefix}: Container "${name}" is unhealthy (${state}, offline for ${t}s).`
}

function buildCountAlert(prefix: string, c: CountSummary): string {
  return `⚠️ ${prefix} Docker container count changed — running: ${c.running}, exited: ${c.exited}, paused: ${c.paused}, dead: ${c.dead}`
}

interface Snap {
  id: string
  name: string
  state: string
  finishedAt: string | null
}

/** List every container; inspect the non-running ones for their exit time. */
async function snapshot(): Promise<Snap[]> {
  const list = await listAllContainers()
  const out: Snap[] = []
  for (const c of list) {
    let finishedAt: string | null = null
    if (c.state !== 'running') {
      try {
        finishedAt = (await inspectContainer(c.id)).finishedAt
      } catch {
        /* container vanished between list and inspect — treat as just-exited */
      }
    }
    out.push({ id: c.id, name: c.name, state: c.state, finishedAt })
  }
  return out
}

/** Fire one alert per down-episode (recovery clears silently). */
async function handleAlert(
  prefix: string,
  name: string,
  enabled: boolean,
  status: ContainerStatus,
  state: string,
  elapsed: number,
): Promise<void> {
  const rt = runtime.get(name) ?? { alert: 'ok' as const }
  const level = enabled && (status === 'warn' || status === 'crit') ? status : 'ok'
  if (level === 'ok') {
    rt.alert = 'ok'
  } else if (rt.alert === 'ok') {
    await dispatch(buildAlert(prefix, name, level, state, elapsed))
    rt.alert = level
  }
  runtime.set(name, rt)
}

/**
 * Core evaluation shared by the poll loop and UI reads. Diffs Docker against the
 * known registry (discovering new containers as disabled, flagging removed ones),
 * builds the rows + count summary, and — when `doAlert` — fires alerts.
 */
async function evaluate(
  now: number,
  doAlert: boolean,
): Promise<{ rows: ContainerRow[]; counts: CountSummary }> {
  const snap = await snapshot()
  const cfg = loadCfg()
  const prefix = messagePrefix()
  const present = new Set(snap.map((c) => c.name))
  let cfgChanged = false

  // Discovery: new containers join as disabled; a reappeared one loses `removed`.
  for (const c of snap) {
    const entry = cfg[c.name]
    if (!entry) {
      cfg[c.name] = { enabled: false }
      cfgChanged = true
    } else if (entry.removed) {
      entry.removed = false
      cfgChanged = true
    }
  }
  // Vanished containers: keep enabled ones as `removed` (CRIT); forget disabled ones.
  const forget = new Set<string>()
  for (const name of Object.keys(cfg)) {
    if (present.has(name)) continue
    const entry = cfg[name]!
    if (entry.enabled) {
      if (!entry.removed) {
        entry.removed = true
        cfgChanged = true
      }
    } else {
      forget.add(name)
      cfgChanged = true
    }
  }
  const live: Record<string, ContainerCfg> = forget.size
    ? Object.fromEntries(Object.entries(cfg).filter(([k]) => !forget.has(k)))
    : cfg
  if (cfgChanged) saveCfg(live)

  const checkedAgo = Math.max(0, (now - lastPollAt) / 1000)
  const rows: ContainerRow[] = []
  const counts: CountSummary = { running: 0, exited: 0, paused: 0, dead: 0 }

  for (const c of snap) {
    if (c.state === 'running') counts.running++
    else if (c.state === 'exited') counts.exited++
    else if (c.state === 'paused') counts.paused++
    else if (c.state === 'dead') counts.dead++

    const enabled = enabledOf(live, c.name)
    const grace = graceOf(live, c.name)
    const elapsed = elapsedFrom(c.finishedAt, now)
    const { status, pendingLevel } = containerStatus(c.state, elapsed, grace)
    if (doAlert) await handleAlert(prefix, c.name, enabled, status, c.state, elapsed)

    rows.push({
      name: c.name,
      state: c.state,
      status: enabled ? status : 'off',
      pendingLevel: enabled ? pendingLevel : null,
      enabled,
      grace,
      offlineFor: c.state === 'running' ? null : elapsed,
      lastCheckedAgo: checkedAgo,
      removed: false,
    })
  }

  // Removed-but-enabled containers persist as CRIT rows until manually cleared.
  for (const name of Object.keys(live)) {
    if (present.has(name) || !live[name]!.removed) continue
    if (doAlert) await handleAlert(prefix, name, true, 'crit', 'removed', 0)
    rows.push({
      name,
      state: 'removed',
      status: 'crit',
      pendingLevel: null,
      enabled: true,
      grace: graceOf(live, name),
      offlineFor: null,
      lastCheckedAgo: checkedAgo,
      removed: true,
    })
  }

  if (doAlert) {
    if (countEnabled()) {
      if (lastRunning !== null && lastRunning !== counts.running) {
        await dispatch(buildCountAlert(prefix, counts))
      }
      lastRunning = counts.running
    } else {
      lastRunning = null // re-baseline whenever the monitor is off
    }
    lastPollAt = now
  }

  return { rows, counts }
}

const emptyCounts = (): CountSummary => ({ running: 0, exited: 0, paused: 0, dead: 0 })

/** Background poll: discovery, grace evaluation, alerts. Never throws. */
export async function pollDocker(now = Date.now()): Promise<void> {
  if (!dockerAvailable()) return
  try {
    await evaluate(now, true)
  } catch (e) {
    console.error('[docker] poll failed:', (e as Error).message)
  }
}

/** Read the current container list + counts + aggregate status (no alerting). */
export async function readContainers(now = Date.now()): Promise<{
  available: boolean
  containers: ContainerRow[]
  status: ContainerStatus
  counts: CountSummary
  countEnabled: boolean
}> {
  if (!dockerAvailable()) {
    return { available: false, containers: [], status: 'ok', counts: emptyCounts(), countEnabled: countEnabled() }
  }
  try {
    const { rows, counts } = await evaluate(now, false)
    const statuses = rows
      .filter((r) => r.enabled && r.status !== 'pending')
      .map((r) => r.status as ContainerStatus)
    return {
      available: true,
      containers: rows,
      status: worstContainerStatus(statuses),
      counts,
      countEnabled: countEnabled(),
    }
  } catch {
    return { available: false, containers: [], status: 'ok', counts: emptyCounts(), countEnabled: countEnabled() }
  }
}
