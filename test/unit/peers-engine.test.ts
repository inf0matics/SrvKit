import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = mkdtempSync(join(tmpdir(), 'srvkit-peers-'))
process.env.DATABASE_PATH = join(base, 'db.sqlite')
process.env.ENCRYPTION_KEY = 'peers-test-key'
process.env.BACKUP_SOURCES_DIR = join(base, 'sources')
delete process.env.TELEGRAM_BOT_TOKEN
delete process.env.TELEGRAM_CHAT_ID

const { store } = await import('../../server/utils/srvkit.ts')
const { saveAlertSettings } = await import('../../server/utils/alerts.ts')
const {
  createPendingKey,
  getPendingKey,
  pairPeer,
  recordPeerPing,
  setIpCheck,
  checkPeers,
  listPeerViews,
  getPingIntervalSec,
  getMissThreshold,
  setHeartbeatTiming,
  setOutgoing,
  sendPing,
  outgoingView,
  resetPeerRuntime,
  sendJournal,
} = await import('../../server/utils/peers.ts')
const {
  PAIRING_KEY_TTL_MS,
  DEFAULT_SILENCE_WINDOW_MS,
  DEFAULT_PING_INTERVAL_SEC,
  DEFAULT_MISS_THRESHOLD,
} = await import('../../lib/peer-heartbeat.ts')

const NOW = 1_700_000_000_000
const realFetch = globalThis.fetch
let sent: string[] = []
/** Every outbound request, so heartbeat sends can be inspected too. */
let requests: { url: string; body: Record<string, unknown> }[] = []
/** Per-test hook: return false to make the heartbeat POST fail. */
let pingSucceeds: () => boolean = () => true
/** Per-test hook: how the heartbeat POST fails (thrown error, or an HTTP code). */
let pingFailure: { throws?: unknown; status?: number } = {}
let telegramMessageId: number | null = null

function mockFetch() {
  globalThis.fetch = (async (url: string, init: { body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    requests.push({ url: String(url), body })
    if (String(url).includes('/api/heartbeat/ping')) {
      if (!pingSucceeds()) {
        if (pingFailure.status) {
          return { ok: false, status: pingFailure.status, json: async () => ({}) } as Response
        }
        throw pingFailure.throws ?? new TypeError('fetch failed')
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    }
    sent.push(body.text as string)
    return {
      ok: true,
      status: 200,
      json: async () => (telegramMessageId ? { result: { message_id: telegramMessageId } } : {}),
    } as Response
  }) as typeof fetch
}

before(mockFetch)

beforeEach(() => {
  sent = []
  requests = []
  pingSucceeds = () => true
  pingFailure = {}
  telegramMessageId = null
  resetPeerRuntime()
  for (const p of store().listPeers()) store().deletePeer(p.id)
  store().setConfig('heartbeat_pending', '')
  store().setConfig('heartbeat_out', '')
  store().setConfig('heartbeat_ip_check', '')
  store().setConfig('heartbeat_journal', '')
  store().setConfig('heartbeat_interval_sec', '')
  store().setConfig('heartbeat_miss_threshold', '')
  delete process.env.HEARTBEAT_INTERVAL_SEC
  delete process.env.HEARTBEAT_MISS_THRESHOLD
  saveAlertSettings({ token: 'TKN', chatId: '123', enabled: true, recovery: true })
})

after(() => {
  globalThis.fetch = realFetch
  store().close()
  rmSync(base, { recursive: true, force: true })
})

test('pending key expires after its TTL', () => {
  const { key } = createPendingKey(NOW)
  assert.equal(getPendingKey(NOW)?.key, key)
  assert.equal(getPendingKey(NOW + PAIRING_KEY_TTL_MS + 1), null)
})

test('pairPeer registers the peer, records its IP, and stores the token encrypted', () => {
  const { key } = createPendingKey(NOW)
  const raw = pairPeer('https://a.example.com', key, '203.0.113.7', NOW)
  assert.ok(raw)
  const peers = store().listPeers()
  assert.equal(peers.length, 1)
  assert.equal(peers[0]!.name, 'a.example.com')
  assert.equal(peers[0]!.ip, '203.0.113.7')
  assert.notEqual(peers[0]!.token, raw) // encrypted at rest, not the plaintext
  assert.equal(getPendingKey(NOW), null) // one-time use
})

test('pairPeer rejects a wrong or expired key', () => {
  createPendingKey(NOW)
  assert.equal(pairPeer('x', 'WRONGKEY', '1.1.1.1', NOW), null)
  const { key } = createPendingKey(NOW)
  assert.equal(pairPeer('x', key, '1.1.1.1', NOW + PAIRING_KEY_TTL_MS + 1), null)
  assert.equal(store().listPeers().length, 0)
})

test('recordPeerPing matches the encrypted token and stamps the peer', () => {
  const raw = pairPeer('a', createPendingKey(NOW).key, '1.2.3.4', NOW)!
  assert.equal(recordPeerPing(raw, 'server1', '1.2.3.4'), 'ok')
  assert.equal(store().listPeers()[0]!.name, 'server1')
  assert.equal(recordPeerPing('bogus-token', 'x', '1.2.3.4'), 'unknown')
})

test('recordPeerPing stores the interval the peer reports', () => {
  const raw = pairPeer('a', createPendingKey(NOW).key, '1.2.3.4', NOW)!
  assert.equal(recordPeerPing(raw, 'server1', '1.2.3.4', 60), 'ok')
  assert.equal(store().listPeers()[0]!.intervalSec, 60)
})

test('a legacy ping without an interval is accepted and leaves the default in play', () => {
  const raw = pairPeer('a', createPendingKey(NOW).key, '1.2.3.4', NOW)!
  assert.equal(recordPeerPing(raw, 'server1', '1.2.3.4'), 'ok')
  const peer = store().listPeers()[0]!
  assert.equal(peer.intervalSec, 0, 'unknown — the global default applies')

  // Silence just over one interval must stay quiet for an old sender too.
  store().setPeerLastSeen(peer.id, new Date(NOW - 6 * 60_000).toISOString())
  return checkPeers(NOW).then(() => assert.equal(sent.length, 0))
})

test('timing: defaults match v1, ENV seeds them, the UI value wins', () => {
  assert.equal(getPingIntervalSec(), DEFAULT_PING_INTERVAL_SEC)
  assert.equal(getMissThreshold(), DEFAULT_MISS_THRESHOLD)

  process.env.HEARTBEAT_INTERVAL_SEC = '120'
  process.env.HEARTBEAT_MISS_THRESHOLD = '3'
  assert.equal(getPingIntervalSec(), 120)
  assert.equal(getMissThreshold(), 3)

  setHeartbeatTiming({ intervalSec: 600, missThreshold: 1 })
  assert.equal(getPingIntervalSec(), 600, 'the stored setting overrides ENV')
  assert.equal(getMissThreshold(), 1)

  setHeartbeatTiming({ intervalSec: 9, missThreshold: 99 })
  assert.equal(getPingIntervalSec(), 30, 'clamped, not rejected')
  assert.equal(getMissThreshold(), 10)
})

test('IP allowlist: off accepts any IP; on rejects a mismatch', () => {
  const raw = pairPeer('a', createPendingKey(NOW).key, '10.0.0.1', NOW)!
  assert.equal(recordPeerPing(raw, '', '9.9.9.9'), 'ok') // default off
  setIpCheck(true)
  assert.equal(recordPeerPing(raw, '', '9.9.9.9'), 'ip-mismatch')
  assert.equal(recordPeerPing(raw, '', '10.0.0.1'), 'ok')
})

test('a single missed heartbeat stays quiet; the second one alerts', async () => {
  pairPeer('a', createPendingKey(NOW).key, '1.2.3.4', NOW)
  const peer = store().listPeers()[0]!
  store().markPeerSeen(peer.id, 'server1', 300)

  // One missed heartbeat (the DNS-blip case that used to page us at 5 min).
  store().setPeerLastSeen(peer.id, new Date(NOW - 7 * 60_000).toISOString())
  await checkPeers(NOW)
  assert.equal(sent.length, 0)
  assert.equal(store().listPeers()[0]!.alertState, 'ok')

  // Two missed heartbeats plus the grace tick.
  store().setPeerLastSeen(peer.id, new Date(NOW - 12 * 60_000).toISOString())
  await checkPeers(NOW)
  assert.equal(sent.length, 1)
  assert.match(sent[0]!, /server1 has not reported in — 2 missed heartbeats \(every 5 min\)/)
  assert.match(sent[0]!, /\[#[0-9a-f]{6}\]/)
  assert.equal(store().listPeers()[0]!.alertState, 'failed')

  await checkPeers(NOW)
  assert.equal(sent.length, 1, 'one alert per incident')
})

test('a peer reporting a short interval is alerted on sooner', async () => {
  pairPeer('a', createPendingKey(NOW).key, '1.2.3.4', NOW)
  const peer = store().listPeers()[0]!
  store().markPeerSeen(peer.id, 'fast', 60) // pings every minute
  store().setPeerLastSeen(peer.id, new Date(NOW - 4 * 60_000).toISOString())

  await checkPeers(NOW)
  assert.equal(sent.length, 1, '2 x 60s + grace is long past')
  assert.match(sent[0]!, /every 1 min/)
})

test('recovery replies to the alert and repeats its reference', async () => {
  telegramMessageId = 4711
  pairPeer('a', createPendingKey(NOW).key, '1.2.3.4', NOW)
  const peer = store().listPeers()[0]!
  store().markPeerSeen(peer.id, 'server1', 300)
  store().setPeerLastSeen(peer.id, new Date(NOW - 12 * 60_000).toISOString())

  await checkPeers(NOW)
  const open = store().listPeers()[0]!
  assert.equal(open.alertMsgId, '4711', 'kept so the recovery can thread under it')
  assert.equal(open.incidentSince, new Date(NOW - 12 * 60_000).toISOString())
  const ref = sent[0]!.match(/\[#([0-9a-f]{6})\]/)![1]!

  store().setPeerLastSeen(peer.id, new Date(NOW).toISOString())
  await checkPeers(NOW)
  assert.equal(sent.length, 2)
  assert.match(sent[1]!, /server1 is back online — silent for 12 min/)
  assert.match(sent[1]!, new RegExp(`\\[#${ref}\\]`), 'same reference as the alert')

  const recovery = requests.at(-1)!.body.reply_parameters as { message_id: number }
  assert.equal(recovery.message_id, 4711)

  const closed = store().listPeers()[0]!
  assert.equal(closed.alertState, 'ok')
  assert.equal(closed.alertRef, null)
  assert.equal(closed.alertMsgId, null)
  assert.equal(closed.incidentSince, null)
})

test('a recovery still goes out when the channel returned no message id', async () => {
  pairPeer('a', createPendingKey(NOW).key, '1.2.3.4', NOW)
  const peer = store().listPeers()[0]!
  store().setPeerLastSeen(peer.id, new Date(NOW - 20 * 60_000).toISOString())
  await checkPeers(NOW)
  store().setPeerLastSeen(peer.id, new Date(NOW).toISOString())
  await checkPeers(NOW)
  assert.equal(sent.length, 2)
  assert.equal(requests.at(-1)!.body.reply_parameters, undefined)
})

test('the heartbeat send reports our configured interval', async () => {
  setOutgoing('https://peer.example.com', 'raw-token')
  setHeartbeatTiming({ intervalSec: 120 })
  await sendPing(NOW, { retryDelays: [] })
  const ping = requests.find((r) => r.url.includes('/api/heartbeat/ping'))!
  assert.equal(ping.body.intervalSec, 120)
  assert.equal(outgoingView()!.ok, true)
})

test('a failed send is retried before the tick counts as failed', async () => {
  setOutgoing('https://peer.example.com', 'raw-token')
  let attempts = 0
  pingSucceeds = () => ++attempts > 1 // first attempt blips, second gets through

  await sendPing(NOW, { retryDelays: [0, 0] })
  assert.equal(attempts, 2)
  assert.equal(outgoingView()!.ok, true, 'a DNS blip must not cost a whole interval')
})

test('a send that keeps failing is recorded as failed after its retries', async () => {
  setOutgoing('https://peer.example.com', 'raw-token')
  let attempts = 0
  pingSucceeds = () => {
    attempts++
    return false
  }

  await sendPing(NOW, { retryDelays: [0, 0] })
  assert.equal(attempts, 3, 'the attempt plus both retries')
  assert.equal(outgoingView()!.ok, false)
})

test('listPeerViews aggregates worst status; null with no peers', () => {
  assert.equal(listPeerViews(NOW).status, null)
  pairPeer('a', createPendingKey(NOW).key, '1.2.3.4', NOW)
  const peer = store().listPeers()[0]!
  store().setPeerLastSeen(peer.id, new Date(NOW - 2 * 60_000).toISOString())
  assert.equal(listPeerViews(NOW).status, 'ok')
  store().setPeerLastSeen(peer.id, new Date(NOW - DEFAULT_SILENCE_WINDOW_MS - 1).toISOString())
  assert.equal(listPeerViews(NOW).status, 'crit')
})

const dnsError = () =>
  Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })

test('a failed send records why, and survives a restart', async () => {
  setOutgoing('https://peer.example.com', 'raw-token')
  pingSucceeds = () => false
  pingFailure = { throws: dnsError() }

  await sendPing(NOW, { retryDelays: [0] })
  const [entry, ...rest] = sendJournal()
  assert.equal(rest.length, 0, 'one entry per tick, not per retry')
  assert.equal(entry!.reason, 'dns')
  assert.match(entry!.detail, /DNS lookup failed for peer\.example\.com/)

  // The journal lives in the config table, so the Peers page keeps telling the
  // truth after a container restart (v1 kept this in a process variable).
  resetPeerRuntime()
  assert.equal(sendJournal().length, 1)
  assert.equal(outgoingView()!.ok, false)
  assert.match(outgoingView()!.lastError!, /DNS lookup failed/)
})

test('a non-2xx answer is recorded as its own cause', async () => {
  setOutgoing('https://peer.example.com', 'raw-token')
  pingSucceeds = () => false
  pingFailure = { status: 401 }

  await sendPing(NOW, { retryDelays: [] })
  const entry = sendJournal()[0]!
  assert.equal(entry.reason, 'http')
  assert.match(entry.detail, /answered HTTP 401 — re-pair this peer/)
})

test('a successful send back-fills the failures and clears the journal', async () => {
  setOutgoing('https://peer.example.com', 'raw-token')
  await sendPing(NOW, { retryDelays: [] }) // one that lands, to anchor the gap

  pingSucceeds = () => false
  pingFailure = { throws: dnsError() }
  await sendPing(NOW + 300_000, { retryDelays: [] })
  await sendPing(NOW + 600_000, { retryDelays: [] })
  assert.equal(sendJournal().length, 2)

  pingSucceeds = () => true
  await sendPing(NOW + 900_000, { retryDelays: [] })

  const ping = requests.filter((r) => r.url.includes('/api/heartbeat/ping')).at(-1)!
  const misses = ping.body.misses as { reason: string; at: string }[]
  assert.equal(misses.length, 2)
  assert.equal(misses[0]!.reason, 'dns')
  assert.equal(misses[0]!.at, new Date(NOW + 300_000).toISOString())
  assert.equal(
    ping.body.lastSuccessAt,
    new Date(NOW).toISOString(),
    'the last heartbeat that landed before the gap, which is what dates it',
  )
  assert.equal(sendJournal().length, 0, 'delivered, so not reported twice')

  // The next heartbeat reports the one that just landed.
  await sendPing(NOW + 1_200_000, { retryDelays: [] })
  const next = requests.filter((r) => r.url.includes('/api/heartbeat/ping')).at(-1)!
  assert.equal(next.body.lastSuccessAt, new Date(NOW + 900_000).toISOString())
  assert.deepEqual(next.body.misses, [])
})

test('the receiver keeps a delivered report and the recovery tells the story', async () => {
  const raw = pairPeer('a', createPendingKey(NOW).key, '1.2.3.4', NOW)!
  const peer = store().listPeers()[0]!
  store().setPeerLastSeen(peer.id, new Date(NOW - 20 * 60_000).toISOString())
  await checkPeers(NOW)
  assert.equal(sent.length, 1)

  // The peer comes back and tells us what happened while it was quiet.
  recordPeerPing(raw, 'server1', '1.2.3.4', 300, {
    lastSuccessAt: new Date(NOW - 20 * 60_000).toISOString(),
    misses: [
      { at: new Date(NOW - 15 * 60_000).toISOString(), reason: 'dns', detail: 'DNS lookup failed for b' },
      { at: new Date(NOW - 10 * 60_000).toISOString(), reason: 'dns', detail: 'DNS lookup failed for b' },
    ],
  })
  await checkPeers(NOW)

  assert.equal(sent.length, 2)
  assert.match(sent[1]!, /is back online/)
  assert.match(sent[1]!, /2 attempts failed: DNS lookup failed for b/)
  assert.equal(store().listPeers()[0]!.lastReport, null, 'consumed by the recovery')
  assert.equal(store().listPeers()[0]!.lastSuccessAt, new Date(NOW - 20 * 60_000).toISOString())
})

test('a peer that reports nothing gets an honest recovery, not a guess', async () => {
  const raw = pairPeer('a', createPendingKey(NOW).key, '1.2.3.4', NOW)!
  const peer = store().listPeers()[0]!
  store().setPeerLastSeen(peer.id, new Date(NOW - 20 * 60_000).toISOString())
  await checkPeers(NOW)

  recordPeerPing(raw, 'server1', '1.2.3.4') // legacy sender: name only
  await checkPeers(NOW)
  assert.match(sent[1]!, /Cause not reported by the peer/)
})

test('a report from before the incident is not pinned on it', async () => {
  const raw = pairPeer('a', createPendingKey(NOW).key, '1.2.3.4', NOW)!
  const peer = store().listPeers()[0]!
  // A stale report, delivered long before this incident began.
  recordPeerPing(raw, 'server1', '1.2.3.4', 300, {
    lastSuccessAt: null,
    misses: [{ at: new Date(NOW - 10 * 3600_000).toISOString(), reason: 'tls', detail: 'TLS error' }],
  })
  store().setPeerLastSeen(peer.id, new Date(NOW - 20 * 60_000).toISOString())
  await checkPeers(NOW)
  store().setPeerLastSeen(peer.id, new Date(NOW).toISOString())
  await checkPeers(NOW)

  assert.match(sent[1]!, /Cause not reported by the peer/)
  assert.doesNotMatch(sent[1]!, /TLS error/)
})
