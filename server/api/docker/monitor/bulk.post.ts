import {
  setAllEnabled,
  readContainers,
  DOCKER_POLL_INTERVAL_SECONDS,
} from '../../../utils/docker-monitor.ts'

// Enable All / Disable All — flips monitoring for every discovered container.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ enabled?: unknown }>(event)
  if (typeof body?.enabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'enabled (boolean) required' })
  }
  await setAllEnabled(body.enabled)
  return { ...(await readContainers()), pollIntervalSeconds: DOCKER_POLL_INTERVAL_SECONDS }
})
