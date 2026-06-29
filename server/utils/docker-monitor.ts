import { store } from './srvkit.ts'
import { dockerAvailable, listAllContainers } from './docker.ts'
import { dispatch, messagePrefix } from './alerts.ts'
import {
  containerStatus,
  worstContainerStatus,
  type ContainerStatus,
} from '../../lib/docker-monitor.ts'

// Per-container monitoring config lives in the `config` kv table, keyed by
// container name (stable across recreate; id is not). Default: disabled, 30s.
const CFG_KEY = 'docker_container_cfg'
const DEFAULT_GRACE = 30
const MIN_GRACE = 10
export const DOCKER_POLL_INTERVAL_SECONDS = 10

interface ContainerCfg {
  enabled?: boolean
  grace?: number
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

/** Enable or disable monitoring for every currently-discovered container. */
export async function setAllEnabled(enabled: boolean): Promise<void> {
  const list = await listAllContainers()
  const cfg = loadCfg()
  for (const c of list) cfg[c.name] = { ...cfg[c.name], enabled }
  saveCfg(cfg)
}

// --- Runtime state (in-memory; resets on restart, acceptable per spec) ---
interface Runtime {
  /** Epoch ms the container was first seen off `running`, for the grace clock. */
  since: number | null
  /** Last alerting level emitted this down-episode ('ok' once recovered). */
  alert: 'ok' | 'warn' | 'crit'
  /** Epoch ms of the last poll that observed this container. */
  lastChecked: number
}
const runtime = new Map<string, Runtime>()

/** Test helper: clear the in-memory runtime (grace clocks + alert state). */
export function resetRuntime(): void {
  runtime.clear()
}

export interface ContainerRow {
  name: string
  state: string
  status: ContainerStatus | 'off'
  pendingLevel: 'warn' | 'crit' | null
  enabled: boolean
  grace: number
  /** Seconds since the container left `running`, else null (it is running). */
  offlineFor: number | null
  /** Seconds since the last poll observed it. */
  lastCheckedAgo: number
}

function buildAlert(
  prefix: string,
  name: string,
  level: 'warn' | 'crit',
  state: string,
  offlineFor: number,
): string {
  const t = Math.round(offlineFor)
  return level === 'crit'
    ? `❌ ${prefix}: Container "${name}" is down (${state}, offline for ${t}s).`
    : `⚠️ ${prefix}: Container "${name}" is unhealthy (${state}, offline for ${t}s).`
}

/**
 * Core evaluation shared by the poll loop and UI reads. Updates the grace clock
 * for every container; when `doAlert` is true it also advances the last-checked
 * timestamp and fires one alert per down-episode (no recovery alert in v1).
 */
async function evaluate(now: number, doAlert: boolean): Promise<ContainerRow[]> {
  const list = await listAllContainers()
  const cfg = loadCfg()
  const prefix = messagePrefix()
  const rows: ContainerRow[] = []

  for (const c of list) {
    const rt = runtime.get(c.name) ?? { since: null, alert: 'ok', lastChecked: now }
    if (doAlert) rt.lastChecked = now
    if (c.state === 'running') rt.since = null
    else if (rt.since === null) rt.since = now
    const offlineFor = rt.since === null ? null : (now - rt.since) / 1000

    const grace = graceOf(cfg, c.name)
    const enabled = enabledOf(cfg, c.name)
    const { status, pendingLevel } = containerStatus(c.state, offlineFor ?? 0, grace)

    if (doAlert) {
      const level = enabled && (status === 'warn' || status === 'crit') ? status : 'ok'
      if (level === 'ok') {
        rt.alert = 'ok' // recovered (or not monitored) — clear silently
      } else if (rt.alert === 'ok') {
        await dispatch(buildAlert(prefix, c.name, level, c.state, offlineFor ?? 0))
        rt.alert = level // alert once until it recovers
      }
    }
    runtime.set(c.name, rt)

    rows.push({
      name: c.name,
      state: c.state,
      status: enabled ? status : 'off',
      pendingLevel: enabled ? pendingLevel : null,
      enabled,
      grace,
      offlineFor,
      lastCheckedAgo: Math.max(0, (now - rt.lastChecked) / 1000),
    })
  }

  // Drop runtime for containers that no longer exist.
  const names = new Set(list.map((c) => c.name))
  for (const k of [...runtime.keys()]) if (!names.has(k)) runtime.delete(k)

  return rows
}

/** Background poll: refresh state, advance grace clocks, fire alerts. Never throws. */
export async function pollDocker(now = Date.now()): Promise<void> {
  if (!dockerAvailable()) return
  try {
    await evaluate(now, true)
  } catch (e) {
    console.error('[docker] poll failed:', (e as Error).message)
  }
}

/** Read the current container list + aggregate status for the UI (no alerting). */
export async function readContainers(
  now = Date.now(),
): Promise<{ available: boolean; containers: ContainerRow[]; status: ContainerStatus }> {
  if (!dockerAvailable()) return { available: false, containers: [], status: 'ok' }
  try {
    const rows = await evaluate(now, false)
    const statuses = rows
      .filter((r) => r.enabled && r.status !== 'pending')
      .map((r) => r.status as ContainerStatus)
    return { available: true, containers: rows, status: worstContainerStatus(statuses) }
  } catch {
    // Socket present but daemon unreachable → treat as not available.
    return { available: false, containers: [], status: 'ok' }
  }
}
