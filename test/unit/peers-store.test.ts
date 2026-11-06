import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from '../../lib/store.ts'

test('peers start empty', () => {
  const s = openStore(':memory:')
  assert.deepEqual(s.listPeers(), [])
  s.close()
})

test('createPeer stores name, token, ip and a full record', () => {
  const s = openStore(':memory:')
  const p = s.createPeer('server1', 'enc-token', '203.0.113.7')
  assert.ok(p.id)
  assert.equal(p.name, 'server1')
  assert.equal(p.token, 'enc-token')
  assert.equal(p.ip, '203.0.113.7')
  assert.equal(p.alertState, 'ok')
  assert.ok(p.lastSeen)
  assert.equal(s.listPeers()[0]!.ip, '203.0.113.7')
  s.close()
})

test('markPeerSeen updates last_seen + name by id', () => {
  const s = openStore(':memory:')
  const p = s.createPeer('old', 'tok', '')
  s.setPeerLastSeen(p.id, '2020-01-01T00:00:00Z')
  s.markPeerSeen(p.id, 'server1')
  const got = s.listPeers()[0]!
  assert.equal(got.name, 'server1')
  assert.notEqual(got.lastSeen, '2020-01-01T00:00:00Z')
  s.close()
})

test('alert state + delete', () => {
  const s = openStore(':memory:')
  const p = s.createPeer('s', 'tok', '')
  s.setPeerAlertState(p.id, 'failed')
  assert.equal(s.listPeers()[0]!.alertState, 'failed')
  assert.equal(s.deletePeer(p.id), true)
  assert.deepEqual(s.listPeers(), [])
  assert.equal(s.deletePeer(p.id), false)
  s.close()
})

test('markPeerSeen records the interval the peer reports', () => {
  const s = openStore(':memory:')
  const p = s.createPeer('s', 'tok', '')
  assert.equal(p.intervalSec, 0, 'unknown until the peer reports one')
  s.markPeerSeen(p.id, 's1', 60)
  assert.equal(s.listPeers()[0]!.intervalSec, 60)
  // A legacy peer that reports nothing must not wipe what we already know.
  s.markPeerSeen(p.id, 's1', 0)
  assert.equal(s.listPeers()[0]!.intervalSec, 60)
  s.close()
})

test('an open incident stores its reference, message id and start', () => {
  const s = openStore(':memory:')
  const p = s.createPeer('s', 'tok', '')
  assert.equal(p.alertRef, null)
  s.setPeerIncident(p.id, { ref: 'a1b2c3', msgId: '4711', since: '2026-11-06T20:15:00Z' })
  const open = s.listPeers()[0]!
  assert.equal(open.alertRef, 'a1b2c3')
  assert.equal(open.alertMsgId, '4711')
  assert.equal(open.incidentSince, '2026-11-06T20:15:00Z')
  s.setPeerIncident(p.id, null)
  const closed = s.listPeers()[0]!
  assert.equal(closed.alertRef, null)
  assert.equal(closed.alertMsgId, null)
  assert.equal(closed.incidentSince, null)
  s.close()
})

test('a delivered failure report is stored and can be consumed', () => {
  const s = openStore(':memory:')
  const p = s.createPeer('s', 'tok', '')
  assert.equal(p.lastReport, null)
  assert.equal(p.lastSuccessAt, null)

  const misses = [{ at: '2026-11-06T20:09:00Z', reason: 'dns' as const, detail: 'DNS lookup failed for a' }]
  s.setPeerReport(p.id, { misses, lastSuccessAt: '2026-11-06T20:04:00Z' })
  const stored = s.listPeers()[0]!
  assert.deepEqual(JSON.parse(stored.lastReport!), misses)
  assert.equal(stored.lastSuccessAt, '2026-11-06T20:04:00Z')

  // Consumed once the recovery has told the story.
  s.setPeerReport(p.id, null)
  assert.equal(s.listPeers()[0]!.lastReport, null)
  assert.equal(
    s.listPeers()[0]!.lastSuccessAt,
    '2026-11-06T20:04:00Z',
    'the last good heartbeat is history, not part of the incident',
  )
  s.close()
})
