export type PingStatus = 'ok' | 'crit'

export interface Ping {
  id: string
  url: string
  name: string
  expectedStatus: number
  intervalSec: number
  enabled: boolean
  status: PingStatus | 'pending' | 'off'
  lastCode: number | null
  lastError: string | null
  lastCheckedAgo: number | null
  failingSince: number | null
}

export interface PingInput {
  url: string
  name?: string
  expectedStatus?: number
  intervalSec?: number
}

export interface PingPatch {
  url?: string
  name?: string
  expectedStatus?: number
  intervalSec?: number
  enabled?: boolean
}

interface PingsData {
  pings: Ping[]
  status: PingStatus
  anyEnabled: boolean
  pollIntervalSeconds: number
}

/**
 * Shared ping-monitoring state — drives the /app/pings page and the sidebar
 * status badge. Client-only fetch (the API is guarded).
 */
export function usePings() {
  const pings = useState<Ping[]>('pings-list', () => [])
  const status = useState<PingStatus>('pings-status', () => 'ok')
  const anyEnabled = useState<boolean>('pings-any-enabled', () => false)

  function apply(d: PingsData) {
    pings.value = d.pings
    status.value = d.status
    anyEnabled.value = d.anyEnabled
  }

  async function refresh() {
    apply(await $fetch<PingsData>('/api/pings'))
  }

  async function add(input: PingInput) {
    apply(await $fetch<PingsData>('/api/pings', { method: 'POST', body: input }))
  }

  async function update(id: string, patch: PingPatch) {
    apply(await $fetch<PingsData>(`/api/pings/${id}`, { method: 'PUT', body: patch }))
  }

  async function remove(id: string) {
    apply(await $fetch<PingsData>(`/api/pings/${id}`, { method: 'DELETE' }))
  }

  return { pings, status, anyEnabled, refresh, add, update, remove }
}
