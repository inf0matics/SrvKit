import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from '../../lib/store.ts'

test('peers start empty', () => {
  const s = openStore(':memory:')
  assert.deepEqual(s.listPeers(), [])
  s.close()
})

test('createPeer returns a full record; lookup by token', () => {
  const s = openStore(':memory:')
  const p = s.createPeer('server1', 'tok-abc')
  assert.ok(p.id)
  assert.equal(p.name, 'server1')
  assert.equal(p.alertState, 'ok')
  assert.ok(p.lastSeen)
  assert.equal(s.getPeerByToken('tok-abc')?.id, p.id)
  assert.equal(s.getPeerByToken('nope'), null)
  s.close()
})

test('recordPing updates last_seen + name; unknown token is a no-op', () => {
  const s = openStore(':memory:')
  const p = s.createPeer('old', 'tok')
  s.setPeerLastSeen(p.id, '2020-01-01T00:00:00Z')
  assert.equal(s.recordPing('tok', 'server1'), true)
  const got = s.getPeerByToken('tok')!
  assert.equal(got.name, 'server1')
  assert.notEqual(got.lastSeen, '2020-01-01T00:00:00Z')
  assert.equal(s.recordPing('unknown', 'x'), false)
  s.close()
})

test('alert state + delete', () => {
  const s = openStore(':memory:')
  const p = s.createPeer('s', 'tok')
  s.setPeerAlertState(p.id, 'failed')
  assert.equal(s.listPeers()[0]!.alertState, 'failed')
  assert.equal(s.deletePeer(p.id), true)
  assert.deepEqual(s.listPeers(), [])
  assert.equal(s.deletePeer(p.id), false)
  s.close()
})
