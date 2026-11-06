export type PeerStatus = 'ok' | 'crit'

export interface PeerView {
  id: string
  name: string
  lastSeen: string
  status: PeerStatus
  lastSeenAgoMs: number
  /** Cadence the peer reports; 0 means it has not told us (older build). */
  intervalSec: number
}

export interface PendingKey {
  key: string
  expiresAt: number
}

export interface OutgoingView {
  domain: string
  lastSentAt: number | null
  ok: boolean | null
  /** Why the last attempt failed; null while sends are landing. */
  lastError: string | null
}

export interface TimingView {
  intervalSec: number
  missThreshold: number
  windowMs: number
}

interface PeersData {
  peers: PeerView[]
  status: PeerStatus | null
  pending: PendingKey | null
  outgoing: OutgoingView | null
  timing: TimingView
  ipAllowlist: boolean
}

/**
 * Shared peer-heartbeat state — drives /app/peers and the sidebar badge.
 * Client-only fetch (the API is guarded).
 */
export function usePeers() {
  const peers = useState<PeerView[]>('peers-list', () => [])
  const status = useState<PeerStatus | null>('peers-status', () => null)
  const pending = useState<PendingKey | null>('peers-pending', () => null)
  const outgoing = useState<OutgoingView | null>('peers-outgoing', () => null)
  const timing = useState<TimingView | null>('peers-timing', () => null)
  const ipAllowlist = useState<boolean>('peers-ip-allowlist', () => false)

  function apply(d: PeersData) {
    peers.value = d.peers
    status.value = d.status
    pending.value = d.pending
    outgoing.value = d.outgoing
    timing.value = d.timing
    ipAllowlist.value = d.ipAllowlist
  }

  async function refresh() {
    apply(await $fetch<PeersData>('/api/peers'))
  }

  /** Probe a domain (step 1). Returns the normalized domain on success. */
  async function connect(domain: string): Promise<string> {
    const r = await $fetch<{ domain: string }>('/api/peers/connect', {
      method: 'POST',
      body: { domain },
    })
    await refresh()
    return r.domain
  }

  /** Submit the pairing key (step 3) and start sending heartbeats. */
  async function pair(domain: string, key: string) {
    await $fetch('/api/peers/pair', { method: 'POST', body: { domain, key } })
    await refresh()
  }

  async function removePeer(id: string) {
    await $fetch(`/api/peers/${id}`, { method: 'DELETE' })
    await refresh()
  }

  async function removeOutgoing() {
    await $fetch('/api/peers/outgoing', { method: 'DELETE' })
    await refresh()
  }

  /** Save send interval and/or miss threshold; the server clamps the values. */
  async function setTiming(input: { intervalSec?: number; missThreshold?: number }) {
    const r = await $fetch<{ timing: TimingView }>('/api/peers/timing', {
      method: 'POST',
      body: input,
    })
    timing.value = r.timing
  }

  async function setSecurity(enabled: boolean) {
    const r = await $fetch<{ ipAllowlist: boolean }>('/api/peers/security', {
      method: 'POST',
      body: { ipAllowlist: enabled },
    })
    ipAllowlist.value = r.ipAllowlist
  }

  return {
    peers,
    status,
    pending,
    outgoing,
    timing,
    ipAllowlist,
    refresh,
    connect,
    pair,
    removePeer,
    removeOutgoing,
    setTiming,
    setSecurity,
  }
}
