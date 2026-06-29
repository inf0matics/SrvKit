import {
  removeContainer,
  readContainers,
  DOCKER_POLL_INTERVAL_SECONDS,
} from '../../../utils/docker-monitor.ts'

// Forget a container — clears a `removed` row from the list.
export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')!
  removeContainer(decodeURIComponent(name))
  return { ...(await readContainers()), pollIntervalSeconds: DOCKER_POLL_INTERVAL_SECONDS }
})
