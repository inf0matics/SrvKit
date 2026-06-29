import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generatePairingKey,
  generatePeerToken,
  normalizeKey,
  formatKey,
  peerStatus,
  worstPeerStatus,
  normalizeDomain,
  PEER_SILENCE_MS,
} from '../../lib/peer-heartbeat.ts'

test('pairing key is 8 unambiguous alphanumeric chars', () => {
  const k = generatePairingKey()
  assert.match(k, /^[A-Z2-9]{8}$/)
  assert.doesNotMatch(k, /[O0I1]/)
})

test('pairing keys are random', () => {
  const keys = new Set(Array.from({ length: 50 }, generatePairingKey))
  assert.ok(keys.size > 45) // overwhelmingly unique
})

test('peer token is a 64-hex-char secret', () => {
  assert.match(generatePeerToken(), /^[0-9a-f]{64}$/)
})

test('normalize/format key round-trips through display form', () => {
  assert.equal(normalizeKey(' a3f7-kp92 '), 'A3F7KP92')
  assert.equal(formatKey('a3f7kp92'), 'A3F7-KP92')
  assert.equal(formatKey('A3F7-KP92'), 'A3F7-KP92')
})

test('peerStatus is OK within the window, CRIT beyond it', () => {
  const now = 1_000_000_000_000
  assert.equal(peerStatus(now - 2 * 60_000, now), 'ok') // 2 min
  assert.equal(peerStatus(now - 6 * 60_000, now), 'crit') // 6 min
  assert.equal(peerStatus(now - PEER_SILENCE_MS, now), 'ok') // exactly on the line
  assert.equal(peerStatus(now - PEER_SILENCE_MS - 1, now), 'crit')
})

test('worstPeerStatus is crit if any peer is silent', () => {
  assert.equal(worstPeerStatus(['ok', 'ok']), 'ok')
  assert.equal(worstPeerStatus(['ok', 'crit']), 'crit')
  assert.equal(worstPeerStatus([]), 'ok')
})

test('normalizeDomain accepts http(s) origins and rejects junk', () => {
  assert.equal(normalizeDomain('https://srvkit.example.com/app/peers'), 'https://srvkit.example.com')
  assert.equal(normalizeDomain('http://localhost:3100'), 'http://localhost:3100')
  assert.equal(normalizeDomain('ftp://x'), null)
  assert.equal(normalizeDomain('not a url'), null)
  assert.equal(normalizeDomain(''), null)
})
