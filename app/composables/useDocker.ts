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
  removed: boolean
}

export interface DockerCounts {
  running: number
  exited: number
  paused: number
  dead: number
}

interface DockerData {
  available: boolean
  containers: DockerContainer[]
  status: DockerStatus
  counts: DockerCounts
  countEnabled: boolean
}

/**
 * Shared Docker-monitoring state — drives the /app/docker page and the sidebar
 * status badge. Client-only fetch (the API is guarded).
 */
export function useDocker() {
  const containers = useState<DockerContainer[]>('docker-containers', () => [])
  const status = useState<DockerStatus>('docker-status', () => 'ok')
  const available = useState<boolean>('docker-available', () => true)
  const counts = useState<DockerCounts>('docker-counts', () => ({
    running: 0,
    exited: 0,
    paused: 0,
    dead: 0,
  }))
  const countEnabled = useState<boolean>('docker-count-enabled', () => false)

  function apply(d: DockerData) {
    containers.value = d.containers
    status.value = d.status
    available.value = d.available
    counts.value = d.counts
    countEnabled.value = d.countEnabled
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

  async function setCount(enabled: boolean) {
    apply(await $fetch<DockerData>('/api/docker/monitor/count', { method: 'POST', body: { enabled } }))
  }

  async function remove(name: string) {
    apply(
      await $fetch<DockerData>(`/api/docker/monitor/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      }),
    )
  }

  return { containers, status, available, counts, countEnabled, refresh, save, setAll, setCount, remove }
}
