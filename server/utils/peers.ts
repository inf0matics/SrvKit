import { store } from './srvkit.ts'
import { dispatch, messagePrefix, getServerName } from './alerts.ts'
import { encryptPassword, decryptPassword } from './backups.ts'
import type { PeerRecord } from '../../lib/store.ts'
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
const IP_CHECK_KEY = 'heartbeat_ip_check'

/** Whether incoming pings must come from the IP recorded at pairing. Default off. */
export const ipCheckEnabled = (): boolean => store().getConfig(IP_CHECK_KEY) === '1'
export function setIpCheck(enabled: boolean): void {
  store().setConfig(IP_CHECK_KEY, enabled ? '1' : '0')
}

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
 * Validate a pairing key and register the requester as a peer, recording its IP
 * for the optional allowlist. Returns the (plaintext) bearer token it should use
 * for pings — stored encrypted at rest. Null if the key is wrong or expired.
 */
export function pairPeer(label: string, key: string, ip: string, now = Date.now()): string | null {
  const pending = getPendingKey(now)
  if (!pending || normalizeKey(key) !== normalizeKey(pending.key)) return null
  clearPendingKey()
  const raw = generatePeerToken()
  // Initial display name: a URL host if `label` is one, else the raw label.
  let name = label || 'SrvKit'
  try {
    name = new URL(label).host
  } catch {
    /* not a URL — keep the label */
  }
  store().createPeer(name, encryptPassword(raw), ip)
  return raw
}

/** Find a peer by the plaintext token it presented (tokens are encrypted at rest). */
function findPeerByToken(raw: string): PeerRecord | null {
  for (const p of store().listPeers()) {
    try {
      if (decryptPassword(p.token) === raw) return p
    } catch {
      /* legacy/un-decryptable token — skip */
    }
  }
  return null
}

export type PingResult = 'ok' | 'unknown' | 'ip-mismatch'

/** Record a ping by bearer token, enforcing the IP allowlist when enabled. */
export function recordPeerPing(token: string, name: string, ip: string): PingResult {
  const peer = findPeerByToken(token)
  if (!peer) return 'unknown'
  if (ipCheckEnabled() && peer.ip && peer.ip !== ip) return 'ip-mismatch'
  store().markPeerSeen(peer.id, name || peer.name)
  return 'ok'
}

// --- Outgoing target (sender A) ---
// Stored as { domain, token } with the token encrypted at rest.
interface StoredOutgoing {
  domain: string
  token: string
}
let lastSentAt: number | null = null
let lastSendOk: boolean | null = null

function getStoredOutgoing(): StoredOutgoing | null {
  try {
    return JSON.parse(store().getConfig(OUT_KEY) || 'null') as StoredOutgoing | null
  } catch {
    return null
  }
}
export function setOutgoing(domain: string, rawToken: string): void {
  store().setConfig(OUT_KEY, JSON.stringify({ domain, token: encryptPassword(rawToken) }))
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
  const out = getStoredOutgoing()
  if (!out) return
  let token: string
  try {
    token = decryptPassword(out.token)
  } catch {
    lastSendOk = false // token unreadable (e.g. key rotated) — re-pair needed
    lastSentAt = now
    return
  }
  try {
    const res = await fetch(`${out.domain}/api/heartbeat/ping`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
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
  const out = getStoredOutgoing()
  return out ? { domain: out.domain, lastSentAt, ok: lastSendOk } : null
}
