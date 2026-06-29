import {
  setContainerConfig,
  readContainers,
  DOCKER_POLL_INTERVAL_SECONDS,
} from '../../../utils/docker-monitor.ts'

// Update one container's monitoring config (enabled flag and/or grace period).
export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')!
  const body = await readBody<{ enabled?: unknown; grace?: unknown }>(event)

  const patch: { enabled?: boolean; grace?: number } = {}
  if (typeof body?.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body?.grace === 'number' && Number.isFinite(body.grace)) patch.grace = body.grace
  setContainerConfig(decodeURIComponent(name), patch)

  return { ...(await readContainers()), pollIntervalSeconds: DOCKER_POLL_INTERVAL_SECONDS }
})
