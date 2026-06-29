import { store } from './srvkit.ts'
import { dispatch, messagePrefix, getServerName } from './alerts.ts'
import {
  generatePairingKey,
  generatePeerToken,
  normalizeKey,
  formatKey,
  peerStatus,
  worstPeerStatus,
  PAIRING_KEY_TTL_MS,
  type PeerStatus,
} from '../../lib/peer-heartbeat.ts'

// Pairing key (receiver side) + outgoing target (sender side) live in the kv
// `config` table. Registered peers live in the `peers` table.
const PENDING_KEY = 'heartbeat_pending'
const OUT_KEY = 'heartbeat_out'

// --- Pending pairing key (receiver B) ---
interface Pending {
  key: string
  expiresAt: number
}

/** Generate (and persist) a one-time pairing key — called by the probe. */
export function createPendingKey(now = Date.now()): Pending {
  const pending: Pending = { key: generatePairingKey(), expiresAt: now + PAIRING_KEY_TTL_MS }
  store().setConfig(PENDING_KEY, JSON.stringify(pending))
  return pending
}

export function getPendingKey(now = Date.now()): Pending | null {
  try {
    const p = JSON.parse(store().getConfig(PENDING_KEY) || 'null') as Pending | null
    return p && p.expiresAt > now ? p : null
  } catch {
    return null
  }
}

function clearPendingKey(): void {
  store().setConfig(PENDING_KEY, '')
}

/**
 * Validate a pairing key and register the requester as a peer, returning the
 * bearer token it should use for pings. Null if the key is wrong or expired.
 */
export function pairPeer(label: string, key: string, now = Date.now()): string | null {
  const pending = getPendingKey(now)
  if (!pending || normalizeKey(key) !== normalizeKey(pending.key)) return null
  clearPendingKey()
  const token = generatePeerToken()
  // Initial display name: a URL host if `label` is one, else the raw label.
  let name = label || 'SrvKit'
  try {
    name = new URL(label).host
  } catch {
    /* not a URL — keep the label */
  }
  store().createPeer(name, token)
  return token
}

/** Record a ping by bearer token; false if the token is unknown. */
export function recordPeerPing(token: string, name: string): boolean {
  const peer = store().getPeerByToken(token)
  if (!peer) return false
  return store().recordPing(token, name || peer.name)
}

// --- Outgoing target (sender A) ---
export interface OutgoingConfig {
  domain: string
  token: string
}
let lastSentAt: number | null = null
let lastSendOk: boolean | null = null

export function getOutgoing(): OutgoingConfig | null {
  try {
    return JSON.parse(store().getConfig(OUT_KEY) || 'null') as OutgoingConfig | null
  } catch {
    return null
  }
}
export function setOutgoing(c: OutgoingConfig): void {
  store().setConfig(OUT_KEY, JSON.stringify(c))
}
export function clearOutgoing(): void {
  store().setConfig(OUT_KEY, '')
  lastSentAt = null
  lastSendOk = null
}

/** Test/observability hook. */
export function resetPeerRuntime(): void {
  lastSentAt = null
  lastSendOk = null
}

/** Send one heartbeat to the configured outgoing target. Never throws. */
export async function sendPing(now = Date.now()): Promise<void> {
  const out = getOutgoing()
  if (!out) return
  try {
    const res = await fetch(`${out.domain}/api/heartbeat/ping`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${out.token}` },
      body: JSON.stringify({ name: getServerName() || 'SrvKit' }),
      signal: AbortSignal.timeout(8000),
    })
    lastSendOk = res.ok
  } catch {
    lastSendOk = false
  }
  lastSentAt = now
}

// --- Watchdog (receiver B) ---
export async function checkPeers(now = Date.now()): Promise<void> {
  const prefix = messagePrefix()
  for (const peer of store().listPeers()) {
    const seen = Date.parse(peer.lastSeen)
    const status = peerStatus(seen, now)
    if (status === 'crit' && peer.alertState === 'ok') {
      store().setPeerAlertState(peer.id, 'failed')
      const mins = Math.max(1, Math.round((now - seen) / 60000))
      await dispatch(`⚠️ ${prefix} ${peer.name} has not reported in — last seen ${mins} min ago.`)
    } else if (status === 'ok' && peer.alertState === 'failed') {
      store().setPeerAlertState(peer.id, 'ok')
      await dispatch(`✅ ${prefix} ${peer.name} is back online.`)
    }
  }
}

// --- Views for the UI ---
export interface PeerView {
  id: string
  name: string
  lastSeen: string
  status: PeerStatus
  lastSeenAgoMs: number
}

export function listPeerViews(now = Date.now()): {
  peers: PeerView[]
  status: PeerStatus | null
} {
  const peers = store()
    .listPeers()
    .map((p) => {
      const seen = Date.parse(p.lastSeen)
      return {
        id: p.id,
        name: p.name,
        lastSeen: p.lastSeen,
        status: peerStatus(seen, now),
        lastSeenAgoMs: now - seen,
      }
    })
  const status = peers.length ? worstPeerStatus(peers.map((p) => p.status)) : null
  return { peers, status }
}

export function pendingView(now = Date.now()): { key: string; expiresAt: number } | null {
  const p = getPendingKey(now)
  return p ? { key: formatKey(p.key), expiresAt: p.expiresAt } : null
}

export function outgoingView(): { domain: string; lastSentAt: number | null; ok: boolean | null } | null {
  const out = getOutgoing()
  return out ? { domain: out.domain, lastSentAt, ok: lastSendOk } : null
}
