import {
  setMetricConfig,
  mounts,
  readMetrics,
  POLL_INTERVAL_SECONDS,
} from '../../../utils/host.ts'

// Update a metric's threshold(s), enabled flag, and/or consecutive-polls count,
// then return the fresh set.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{
    enabled?: unknown
    warn?: unknown
    crit?: unknown
    polls?: unknown
  }>(event)

  const patch: { enabled?: boolean; warn?: number; crit?: number; polls?: number } = {}
  if (typeof body?.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body?.warn === 'number' && Number.isFinite(body.warn)) patch.warn = body.warn
  if (typeof body?.crit === 'number' && Number.isFinite(body.crit)) patch.crit = body.crit
  if (typeof body?.polls === 'number' && Number.isFinite(body.polls)) {
    patch.polls = Math.max(1, Math.round(body.polls))
  }
  setMetricConfig(id, patch)

  const mts = mounts()
  const available = mts.filter((m) => !m.optional).every((m) => m.present)
  return { mounts: mts, available, ...readMetrics(), pollIntervalSeconds: POLL_INTERVAL_SECONDS }
})
