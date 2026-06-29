import { pollDocker, DOCKER_POLL_INTERVAL_SECONDS } from '../utils/docker-monitor.ts'

// Poll Docker every 10s (independent of host monitoring) to advance grace
// clocks and fire alerts. A no-op when the socket isn't mounted.
export default defineNitroPlugin(() => {
  pollDocker()
  setInterval(() => pollDocker(), DOCKER_POLL_INTERVAL_SECONDS * 1000)
})
