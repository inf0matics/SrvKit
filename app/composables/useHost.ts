export type HostStatus = 'ok' | 'warn' | 'crit' | 'na' | 'info' | 'off' | 'pending'

export interface HostMetric {
  id: string
  name: string
  category: string
  value: number | null
  display: string
  unit: string
  warn: number | null
  crit: number | null
  dir: 'high' | 'low'
  status: HostStatus
  polls: number
  pollCount: number
  pendingLevel: 'warn' | 'crit' | null
  enabled: boolean
  informational: boolean
  note?: string
}

export interface HostMount {
  path: string
  present: boolean
  compose: string
  section: string
  optional: boolean
}

interface HostData {
  mounts: HostMount[]
  available: boolean
  metrics: HostMetric[]
  status: HostStatus
  pollIntervalSeconds: number
}

/**
 * Shared host-monitoring state — drives the /app/host page and the sidebar
 * status badge. Client-only fetch (the API is guarded).
 */
export function useHost() {
  const metrics = useState<HostMetric[]>('host-metrics', () => [])
  const mounts = useState<HostMount[]>('host-mounts', () => [])
  const status = useState<HostStatus>('host-status', () => 'ok')
  const available = useState<boolean>('host-available', () => true)
  const pollIntervalSeconds = useState<number>('host-poll-interval', () => 60)
  const missing = computed(() => mounts.value.filter((m) => !m.present))

  function apply(d: HostData) {
    metrics.value = d.metrics
    mounts.value = d.mounts
    status.value = d.status
    available.value = d.available
    pollIntervalSeconds.value = d.pollIntervalSeconds
  }

  async function refresh() {
    apply(await $fetch<HostData>('/api/host/metrics'))
  }

  async function saveMetric(
    id: string,
    patch: { enabled?: boolean; warn?: number; crit?: number; polls?: number },
  ) {
    apply(await $fetch<HostData>(`/api/host/metrics/${id}`, { method: 'PUT', body: patch }))
  }

  return {
    metrics,
    mounts,
    missing,
    status,
    available,
    pollIntervalSeconds,
    refresh,
    saveMetric,
  }
}
