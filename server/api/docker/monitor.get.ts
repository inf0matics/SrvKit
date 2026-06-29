import { readContainers, DOCKER_POLL_INTERVAL_SECONDS } from '../../utils/docker-monitor.ts'

// Monitored container list with per-container status + the worst-of aggregate.
export default defineEventHandler(async () => {
  return { ...(await readContainers()), pollIntervalSeconds: DOCKER_POLL_INTERVAL_SECONDS }
})
