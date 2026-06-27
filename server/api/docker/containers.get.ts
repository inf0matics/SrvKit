import { dockerAvailable, listRunningContainers } from '../../utils/docker.ts'

// Running Docker containers (for the PostgreSQL job's container picker), plus
// whether the Docker socket is mounted at all (drives the create-modal notice).
export default defineEventHandler(async () => {
  const available = dockerAvailable()
  if (!available) return { available: false, containers: [] }
  try {
    return { available: true, containers: await listRunningContainers() }
  } catch (e) {
    return { available: true, containers: [], error: (e as Error).message }
  }
})
