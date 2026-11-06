import { timingSafeEqual } from 'node:crypto'
import { store } from './srvkit.ts'
import { dispatch, messagePrefix, getServerName } from './alerts.ts'
import { encryptPassword, decryptPassword } from './backups.ts'
import type { PeerRecord, PeerReport } from '../../lib/store.ts'
import {
  generatePairingKey,
  generatePeerToken,
  generateIncidentRef,
  normalizeKey,
  formatKey,
  peerStatus,
  worstPeerStatus,
  normalizePingInterval,
  normalizeMissThreshold,
  silenceWindowMs,
  buildPeerSilentMessage,
  buildPeerRecoveredMessage,
  PAIRING_KEY_TTL_MS,
  classifySendError,
  classifyHttpStatus,
  appendFailure,
  DEFAULT_PING_INTERVAL_SEC,
  DEFAULT_MISS_THRESHOLD,
  type PeerStatus,
  type SendFailure,
} from '../../lib/peer-heartbeat.ts'

// Pairing key (receiver side) + outgoing target (sender side) live in the kv
// `config` table. Registered peers live in the `peers` table.
const PENDING_KEY = 'heartbeat_pending'
const OUT_KEY = 'heartbeat_out'
const IP_CHECK_KEY = 'heartbeat_ip_check'
const INTERVAL_KEY = 'heartbeat_interval_sec'
const THRESHOLD_KEY = 'heartbeat_miss_threshold'
const JOURNAL_KEY = 'heartbeat_journal'

/**
 * Timing resolution, same ladder as `alerts_repeat_hours`: the value set in the
 * UI wins, ENV seeds a fresh deploy, and the constant is the last word — which
 * is v1's cadence, so an untouched install behaves as before.
 */
export function getPingIntervalSec(): number {
  const stored = store().getConfig(INTERVAL_KEY)
  if (stored) return normalizePingInterval(stored)
  return normalizePingInterval(process.env.HEARTBEAT_INTERVAL_SEC ?? DEFAULT_PING_INTERVAL_SEC)
}

export function getMissThreshold(): number {
  const stored = store().getConfig(THRESHOLD_KEY)
  if (stored) return normalizeMissThreshold(stored)
  return normalizeMissThreshold(process.env.HEARTBEAT_MISS_THRESHOLD ?? DEFAULT_MISS_THRESHOLD)
}

/** Persist either timing setting; values out of range are clamped, not refused. */
export function setHeartbeatTiming(input: {
  intervalSec?: unknown
  missThreshold?: unknown
}): void {
  if (input.intervalSec !== undefined) {
    store().setConfig(INTERVAL_KEY, String(normalizePingInterval(input.intervalSec)))
  }
  if (input.missThreshold !== undefined) {
    store().setConfig(THRESHOLD_KEY, String(normalizeMissThreshold(input.missThreshold)))
  }
}

export interface TimingView {
  intervalSec: number
  missThreshold: number
  /** Silence tolerated for a peer on the default interval, for the UI to show. */
  windowMs: number
}

export function timingView(): TimingView {
  const intervalSec = getPingIntervalSec()
  const missThreshold = getMissThreshold()
  return { intervalSec, missThreshold, windowMs: silenceWindowMs(intervalSec, missThreshold) }
}

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

/** Constant-time string compare (length check leaks length only, which is fixed). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** Find a peer by the plaintext token it presented (tokens are encrypted at rest). */
function findPeerByToken(raw: string): PeerRecord | null {
  for (const p of store().listPeers()) {
    try {
      if (safeEqual(decryptPassword(p.token), raw)) return p
    } catch {
      /* legacy/un-decryptable token — skip */
    }
  }
  return null
}

export type PingResult = 'ok' | 'unknown' | 'ip-mismatch'

/**
 * Record a ping by bearer token, enforcing the IP allowlist when enabled.
 * `intervalSec` is what the sender says its cadence is; a peer on an older
 * build reports nothing, and 0 leaves the stored value (if any) alone.
 */
export function recordPeerPing(
  token: string,
  name: string,
  ip: string,
  intervalSec = 0,
  report?: PeerReport,
): PingResult {
  const peer = findPeerByToken(token)
  if (!peer) return 'unknown'
  if (ipCheckEnabled() && peer.ip && peer.ip !== ip) return 'ip-mismatch'
  store().markPeerSeen(
    peer.id,
    name || peer.name,
    intervalSec > 0 ? normalizePingInterval(intervalSec) : 0,
  )
  // Only a report with something in it is worth keeping; an empty one on every
  // ordinary heartbeat would overwrite a backlog the recovery has not told yet.
  if (report && (report.misses.length || report.lastSuccessAt)) {
    store().setPeerReport(peer.id, report)
  }
  return 'ok'
}

// --- Outgoing target (sender A) ---
// Stored as { domain, token } with the token encrypted at rest.
interface StoredOutgoing {
  domain: string
  token: string
}
/**
 * Send state lives in the `config` table rather than in process memory: the
 * failures of a silent stretch have to outlive a restart to be back-filled at
 * all, and the Peers page no longer claims "not sent yet" after every deploy.
 */
interface Journal {
  lastSentAt: number | null
  lastSendOk: boolean | null
  /** Undelivered failures, oldest first. */
  misses: SendFailure[]
  /** ISO timestamp of the last heartbeat that landed. */
  lastSuccessAt: string | null
}
const EMPTY_JOURNAL: Journal = {
  lastSentAt: null,
  lastSendOk: null,
  misses: [],
  lastSuccessAt: null,
}

function loadJournal(): Journal {
  try {
    const raw = JSON.parse(store().getConfig(JOURNAL_KEY) || 'null') as Partial<Journal> | null
    if (!raw) return { ...EMPTY_JOURNAL }
    return {
      lastSentAt: typeof raw.lastSentAt === 'number' ? raw.lastSentAt : null,
      lastSendOk: typeof raw.lastSendOk === 'boolean' ? raw.lastSendOk : null,
      misses: Array.isArray(raw.misses) ? raw.misses : [],
      lastSuccessAt: typeof raw.lastSuccessAt === 'string' ? raw.lastSuccessAt : null,
    }
  } catch {
    return { ...EMPTY_JOURNAL }
  }
}

function saveJournal(journal: Journal): void {
  store().setConfig(JOURNAL_KEY, JSON.stringify(journal))
}

/** The failures waiting to be back-filled — for tests and the Peers page. */
export function sendJournal(): SendFailure[] {
  return loadJournal().misses
}

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
  store().setConfig(JOURNAL_KEY, '')
}

/** Test hook: drop anything cached in this process (simulates a restart). */
export function resetPeerRuntime(): void {
  /* nothing is cached in memory any more — send state lives in the DB */
}

/**
 * Backoff between attempts within one tick. A single failed attempt used to
 * cost a whole interval of silence — long enough, at v1's window, to page the
 * receiver over a one-second DNS hiccup at the hoster.
 */
export const SEND_RETRY_DELAYS_MS = [5_000, 20_000]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The host a cause names, so the message says where the lookup failed. */
function hostOf(domain: string): string {
  try {
    return new URL(domain).host
  } catch {
    return domain
  }
}

/**
 * One attempt. Returns null when it landed, else the cause — which only the
 * sender can see, and only at this moment.
 */
async function attemptPing(
  domain: string,
  token: string,
  body: Record<string, unknown>,
): Promise<Omit<SendFailure, 'at'> | null> {
  try {
    const res = await fetch(`${domain}/api/heartbeat/ping`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
    return res.ok ? null : classifyHttpStatus(res.status, hostOf(domain))
  } catch (e) {
    return classifySendError(e, hostOf(domain))
  }
}

/**
 * Send one heartbeat to the configured outgoing target, retrying a failed
 * attempt within the same tick. Never throws.
 */
export async function sendPing(
  now = Date.now(),
  opts: { retryDelays?: number[] } = {},
): Promise<void> {
  const out = getStoredOutgoing()
  if (!out) return
  const journal = loadJournal()
  let token: string
  try {
    token = decryptPassword(out.token)
  } catch {
    // Token unreadable (e.g. ENCRYPTION_KEY rotated) — re-pairing is the fix,
    // and saying so beats another "could not reach" on the peer's side.
    saveJournal({
      ...journal,
      lastSentAt: now,
      lastSendOk: false,
      misses: appendFailure(journal.misses, {
        at: new Date(now).toISOString(),
        reason: 'unreachable',
        detail: `Stored peer token could not be read — re-pair ${hostOf(out.domain)}`,
      }),
    })
    return
  }

  const delays = opts.retryDelays ?? SEND_RETRY_DELAYS_MS
  // The pending failures ride along: the receiver saw nothing, so this is the
  // only chance to tell it why.
  const body = {
    name: getServerName() || 'SrvKit',
    intervalSec: getPingIntervalSec(),
    lastSuccessAt: journal.lastSuccessAt,
    misses: journal.misses,
  }

  let cause: Omit<SendFailure, 'at'>
  for (let attempt = 0; ; attempt++) {
    const failure = await attemptPing(out.domain, token, body)
    if (!failure) {
      const at = new Date(now).toISOString()
      // Delivered — drop the backlog so it is never reported twice.
      saveJournal({ lastSentAt: now, lastSendOk: true, misses: [], lastSuccessAt: at })
      return
    }
    cause = failure
    if (attempt >= delays.length) break
    await sleep(delays[attempt]!)
  }

  // One entry per tick, not per retry: a tick is one missed heartbeat.
  saveJournal({
    ...journal,
    lastSentAt: now,
    lastSendOk: false,
    misses: appendFailure(journal.misses, { at: new Date(now).toISOString(), ...cause }),
  })
}

// --- Watchdog (receiver B) ---

/**
 * The failures the peer back-filled for *this* incident. A report that predates
 * it belongs to an older gap, and pinning it on this one would be a plausible,
 * confident lie.
 */
function incidentMisses(peer: PeerRecord, sinceMs: number): SendFailure[] {
  if (!peer.lastReport) return []
  try {
    const all = JSON.parse(peer.lastReport) as SendFailure[]
    return Array.isArray(all) ? all.filter((m) => Date.parse(m.at) >= sinceMs) : []
  } catch {
    return []
  }
}

/** The cadence to judge a peer by: the one it reports, else our own default. */
function effectiveInterval(peer: PeerRecord, globalIntervalSec: number): number {
  return peer.intervalSec > 0 ? peer.intervalSec : globalIntervalSec
}

export async function checkPeers(now = Date.now()): Promise<void> {
  const prefix = messagePrefix()
  const globalIntervalSec = getPingIntervalSec()
  const threshold = getMissThreshold()
  for (const peer of store().listPeers()) {
    const seen = Date.parse(peer.lastSeen)
    const intervalSec = effectiveInterval(peer, globalIntervalSec)
    const status = peerStatus(seen, now, silenceWindowMs(intervalSec, threshold))

    if (status === 'crit' && peer.alertState === 'ok') {
      // The incident starts at the last heartbeat, not at the moment we noticed
      // — that is what makes the recovery able to state the real gap.
      const ref = generateIncidentRef()
      const since = peer.lastSeen
      store().setPeerAlertState(peer.id, 'failed')
      store().setPeerIncident(peer.id, { ref, msgId: null, since })
      const refs = await dispatch(
        buildPeerSilentMessage(prefix, {
          name: peer.name,
          intervalSec,
          lastSeenMs: seen,
          nowMs: now,
          threshold,
          ref,
        }),
      )
      if (refs.telegramMessageId) {
        store().setPeerIncident(peer.id, { ref, msgId: String(refs.telegramMessageId), since })
      }
    } else if (status === 'ok' && peer.alertState === 'failed') {
      const sinceMs = peer.incidentSince ? Date.parse(peer.incidentSince) : seen
      const msgId = peer.alertMsgId ? Number(peer.alertMsgId) : NaN
      store().setPeerAlertState(peer.id, 'ok')
      store().setPeerIncident(peer.id, null)
      store().setPeerReport(peer.id, null) // consumed by this message
      await dispatch(
        buildPeerRecoveredMessage(prefix, {
          name: peer.name,
          silentMs: seen - sinceMs,
          ref: peer.alertRef,
          misses: incidentMisses(peer, sinceMs),
        }),
        { replyTo: Number.isFinite(msgId) ? { telegramMessageId: msgId } : null },
      )
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
  /** Cadence the peer reports; 0 means it has not told us (older build). */
  intervalSec: number
}

export function listPeerViews(now = Date.now()): {
  peers: PeerView[]
  status: PeerStatus | null
} {
  const globalIntervalSec = getPingIntervalSec()
  const threshold = getMissThreshold()
  const peers = store()
    .listPeers()
    .map((p) => {
      const seen = Date.parse(p.lastSeen)
      return {
        id: p.id,
        name: p.name,
        lastSeen: p.lastSeen,
        status: peerStatus(seen, now, silenceWindowMs(effectiveInterval(p, globalIntervalSec), threshold)),
        lastSeenAgoMs: now - seen,
        intervalSec: p.intervalSec,
      }
    })
  const status = peers.length ? worstPeerStatus(peers.map((p) => p.status)) : null
  return { peers, status }
}

export function pendingView(now = Date.now()): { key: string; expiresAt: number } | null {
  const p = getPendingKey(now)
  return p ? { key: formatKey(p.key), expiresAt: p.expiresAt } : null
}

export function outgoingView(): {
  domain: string
  lastSentAt: number | null
  ok: boolean | null
  /** Why the last attempt failed, so the page says more than "failed". */
  lastError: string | null
} | null {
  const out = getStoredOutgoing()
  if (!out) return null
  const journal = loadJournal()
  return {
    domain: out.domain,
    lastSentAt: journal.lastSentAt,
    ok: journal.lastSendOk,
    lastError: journal.lastSendOk === false ? journal.misses.at(-1)?.detail ?? null : null,
  }
}
