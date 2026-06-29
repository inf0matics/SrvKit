export type PeerStatus = 'ok' | 'crit'

export interface PeerView {
  id: string
  name: string
  lastSeen: string
  status: PeerStatus
  lastSeenAgoMs: number
}

export interface PendingKey {
  key: string
  expiresAt: number
}

export interface OutgoingView {
  domain: string
  lastSentAt: number | null
  ok: boolean | null
}

interface PeersData {
  peers: PeerView[]
  status: PeerStatus | null
  pending: PendingKey | null
  outgoing: OutgoingView | null
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

  function apply(d: PeersData) {
    peers.value = d.peers
    status.value = d.status
    pending.value = d.pending
    outgoing.value = d.outgoing
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

  return { peers, status, pending, outgoing, refresh, connect, pair, removePeer, removeOutgoing }
}
