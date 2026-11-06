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
  normalizePingInterval,
  normalizeMissThreshold,
  silenceWindowMs,
  generateIncidentRef,
  buildPeerSilentMessage,
  buildPeerRecoveredMessage,
  DEFAULT_PING_INTERVAL_SEC,
  DEFAULT_MISS_THRESHOLD,
  DEFAULT_SILENCE_WINDOW_MS,
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
  assert.equal(peerStatus(now - 6 * 60_000, now, 5 * 60_000), 'crit')
  assert.equal(peerStatus(now - 5 * 60_000, now, 5 * 60_000), 'ok') // exactly on the line
  assert.equal(peerStatus(now - 5 * 60_000 - 1, now, 5 * 60_000), 'crit')
})

test('one missed heartbeat stays OK at the default threshold of 2', () => {
  const now = 1_000_000_000_000
  const window = DEFAULT_SILENCE_WINDOW_MS
  // The flapping bug: at 5 min of silence the v1 window had already fired.
  assert.equal(peerStatus(now - 6 * 60_000, now, window), 'ok')
  assert.equal(peerStatus(now - 10 * 60_000, now, window), 'ok')
  assert.equal(peerStatus(now - 12 * 60_000, now, window), 'crit')
})

test('silenceWindowMs is interval x threshold plus one watchdog tick', () => {
  assert.equal(silenceWindowMs(300, 2), 300_000 * 2 + 60_000)
  assert.equal(silenceWindowMs(60, 1), 60_000 + 60_000)
  assert.equal(
    DEFAULT_SILENCE_WINDOW_MS,
    silenceWindowMs(DEFAULT_PING_INTERVAL_SEC, DEFAULT_MISS_THRESHOLD),
  )
})

test('normalizePingInterval clamps to a sane range and defaults to today\'s value', () => {
  assert.equal(normalizePingInterval(600), 600)
  assert.equal(normalizePingInterval('120'), 120)
  assert.equal(normalizePingInterval(5), 30) // below the floor
  assert.equal(normalizePingInterval(99_999), 3600) // above the ceiling
  assert.equal(normalizePingInterval('nonsense'), DEFAULT_PING_INTERVAL_SEC)
  assert.equal(normalizePingInterval(undefined), DEFAULT_PING_INTERVAL_SEC)
  assert.equal(DEFAULT_PING_INTERVAL_SEC, 300) // unchanged from v1
})

test('normalizeMissThreshold clamps to 1..10 and defaults to 2', () => {
  assert.equal(normalizeMissThreshold(1), 1)
  assert.equal(normalizeMissThreshold('3'), 3)
  assert.equal(normalizeMissThreshold(0), 1)
  assert.equal(normalizeMissThreshold(50), 10)
  assert.equal(normalizeMissThreshold(''), DEFAULT_MISS_THRESHOLD)
  assert.equal(DEFAULT_MISS_THRESHOLD, 2)
})

test('incident references are short, readable and unique', () => {
  const ref = generateIncidentRef()
  assert.match(ref, /^[0-9a-f]{6}$/)
  const refs = new Set(Array.from({ length: 50 }, generateIncidentRef))
  assert.ok(refs.size > 45)
})

test('silent message names the miss count, interval, last heartbeat and reference', () => {
  const now = Date.parse('2026-11-06T20:15:00Z')
  const text = buildPeerSilentMessage('[server2|SrvKit]', {
    name: 'server1',
    intervalSec: 300,
    lastSeenMs: Date.parse('2026-11-06T20:04:00Z'),
    nowMs: now,
    threshold: 2,
    ref: 'a1b2c3',
  })
  assert.match(text, /server1 has not reported in/)
  assert.match(text, /2 missed heartbeats \(every 5 min\)/)
  assert.match(text, /2026-11-06 20:04 UTC/)
  assert.match(text, /11 min ago/)
  assert.match(text, /\[#a1b2c3\]/)
})

test('silent message counts further missed intervals as silence grows', () => {
  const base = {
    name: 'server1',
    intervalSec: 300,
    lastSeenMs: Date.parse('2026-11-06T20:00:00Z'),
    threshold: 2,
    ref: 'a1b2c3',
  }
  assert.match(
    buildPeerSilentMessage('[p]', { ...base, nowMs: Date.parse('2026-11-06T20:31:00Z') }),
    /6 missed heartbeats/,
  )
  // Never fewer than the threshold that triggered the alert.
  assert.match(
    buildPeerSilentMessage('[p]', { ...base, nowMs: Date.parse('2026-11-06T20:11:00Z') }),
    /2 missed heartbeats/,
  )
})

test('recovered message carries the same reference and how long it was silent', () => {
  const text = buildPeerRecoveredMessage('[server2|SrvKit]', {
    name: 'server1',
    silentMs: 12 * 60_000,
    ref: 'a1b2c3',
  })
  assert.match(text, /server1 is back online/)
  assert.match(text, /silent for 12 min/)
  assert.match(text, /\[#a1b2c3\]/)
})

test('a recovery with no open reference still reads correctly', () => {
  const text = buildPeerRecoveredMessage('[p]', { name: 's1', silentMs: 90 * 60_000, ref: null })
  assert.match(text, /s1 is back online/)
  assert.match(text, /silent for 1 h 30 min/)
  assert.doesNotMatch(text, /#/)
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
