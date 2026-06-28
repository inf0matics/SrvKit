import { setMetricConfig, mounts, readMetrics } from '../../../utils/host.ts'

// Update a metric's threshold(s) and/or enabled flag, then return the fresh set.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ enabled?: unknown; warn?: unknown; crit?: unknown }>(event)

  const patch: { enabled?: boolean; warn?: number; crit?: number } = {}
  if (typeof body?.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body?.warn === 'number' && Number.isFinite(body.warn)) patch.warn = body.warn
  if (typeof body?.crit === 'number' && Number.isFinite(body.crit)) patch.crit = body.crit
  setMetricConfig(id, patch)

  const mts = mounts()
  return { mounts: mts, available: mts.every((m) => m.present), ...readMetrics() }
})
