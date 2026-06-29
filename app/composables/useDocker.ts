export type DockerStatus = 'ok' | 'warn' | 'crit'

export interface DockerContainer {
  name: string
  state: string
  status: 'ok' | 'warn' | 'crit' | 'pending' | 'off'
  pendingLevel: 'warn' | 'crit' | null
  enabled: boolean
  grace: number
  offlineFor: number | null
  lastCheckedAgo: number
}

interface DockerData {
  available: boolean
  containers: DockerContainer[]
  status: DockerStatus
}

/**
 * Shared Docker-monitoring state — drives the /app/docker page and the sidebar
 * status badge. Client-only fetch (the API is guarded).
 */
export function useDocker() {
  const containers = useState<DockerContainer[]>('docker-containers', () => [])
  const status = useState<DockerStatus>('docker-status', () => 'ok')
  const available = useState<boolean>('docker-available', () => true)

  function apply(d: DockerData) {
    containers.value = d.containers
    status.value = d.status
    available.value = d.available
  }

  async function refresh() {
    apply(await $fetch<DockerData>('/api/docker/monitor'))
  }

  async function save(name: string, patch: { enabled?: boolean; grace?: number }) {
    apply(
      await $fetch<DockerData>(`/api/docker/monitor/${encodeURIComponent(name)}`, {
        method: 'POST',
        body: patch,
      }),
    )
  }

  async function setAll(enabled: boolean) {
    apply(await $fetch<DockerData>('/api/docker/monitor/bulk', { method: 'POST', body: { enabled } }))
  }

  return { containers, status, available, refresh, save, setAll }
}
