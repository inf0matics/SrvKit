import {
  setCountMonitor,
  readContainers,
  DOCKER_POLL_INTERVAL_SECONDS,
} from '../../../utils/docker-monitor.ts'

// Toggle the container-count change monitor (its own alert, independent of rows).
export default defineEventHandler(async (event) => {
  const body = await readBody<{ enabled?: unknown }>(event)
  if (typeof body?.enabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'enabled (boolean) required' })
  }
  setCountMonitor(body.enabled)
  return { ...(await readContainers()), pollIntervalSeconds: DOCKER_POLL_INTERVAL_SECONDS }
})
