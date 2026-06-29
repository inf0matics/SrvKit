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
