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
  checkPeers,
  listPeerViews,
} = await import('../../server/utils/peers.ts')
const { PAIRING_KEY_TTL_MS, PEER_SILENCE_MS } = await import('../../lib/peer-heartbeat.ts')

const NOW = 1_700_000_000_000
const realFetch = globalThis.fetch
let sent: string[] = []

before(() => {
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sent.push((JSON.parse(init.body) as { text: string }).text)
    return { ok: true, status: 200, json: async () => ({}) } as Response
  }) as typeof fetch
})

beforeEach(() => {
  sent = []
  for (const p of store().listPeers()) store().deletePeer(p.id)
  store().setConfig('heartbeat_pending', '')
  store().setConfig('heartbeat_out', '')
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

test('pairPeer registers the peer on a valid key and consumes it', () => {
  const { key } = createPendingKey(NOW)
  const token = pairPeer('https://a.example.com', key, NOW)
  assert.ok(token)
  const peers = store().listPeers()
  assert.equal(peers.length, 1)
  assert.equal(peers[0]!.name, 'a.example.com') // URL host
  assert.equal(getPendingKey(NOW), null) // one-time use
})

test('pairPeer rejects a wrong or expired key', () => {
  createPendingKey(NOW)
  assert.equal(pairPeer('x', 'WRONGKEY', NOW), null)
  const { key } = createPendingKey(NOW)
  assert.equal(pairPeer('x', key, NOW + PAIRING_KEY_TTL_MS + 1), null)
  assert.equal(store().listPeers().length, 0)
})

test('recordPeerPing stamps the peer and updates its name', () => {
  const token = pairPeer('a', createPendingKey(NOW).key, NOW)!
  assert.equal(recordPeerPing(token, 'server1'), true)
  assert.equal(store().getPeerByToken(token)?.name, 'server1')
  assert.equal(recordPeerPing('bogus', 'x'), false)
})

test('watchdog alerts once when a peer goes silent, then on recovery', async () => {
  const token = pairPeer('a', createPendingKey(NOW).key, NOW)!
  const peer = store().getPeerByToken(token)!
  store().setPeerLastSeen(peer.id, new Date(NOW - 6 * 60_000).toISOString())

  await checkPeers(NOW)
  assert.equal(sent.length, 1)
  assert.match(sent[0]!, /has not reported in — last seen 6 min ago\./)
  assert.equal(store().listPeers()[0]!.alertState, 'failed')

  await checkPeers(NOW) // still silent → no repeat
  assert.equal(sent.length, 1)

  store().setPeerLastSeen(peer.id, new Date(NOW).toISOString()) // pinged again
  await checkPeers(NOW)
  assert.equal(sent.length, 2)
  assert.match(sent[1]!, /is back online\./)
  assert.equal(store().listPeers()[0]!.alertState, 'ok')
})

test('listPeerViews aggregates worst status; null with no peers', () => {
  assert.equal(listPeerViews(NOW).status, null)
  const token = pairPeer('a', createPendingKey(NOW).key, NOW)!
  const peer = store().getPeerByToken(token)!
  store().setPeerLastSeen(peer.id, new Date(NOW - 2 * 60_000).toISOString())
  assert.equal(listPeerViews(NOW).status, 'ok')
  store().setPeerLastSeen(peer.id, new Date(NOW - PEER_SILENCE_MS - 1).toISOString())
  assert.equal(listPeerViews(NOW).status, 'crit')
})
