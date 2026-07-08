import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeInterval,
  normalizeExpectedStatus,
  normalizeUrl,
  pingStatus,
  worstPingStatus,
  DEFAULT_INTERVAL_SEC,
  DEFAULT_EXPECTED_STATUS,
} from '../../lib/ping-monitor.ts'

test('normalizeInterval snaps to allowed options, else default', () => {
  assert.equal(normalizeInterval(60), 60)
  assert.equal(normalizeInterval(3600), 3600)
  assert.equal(normalizeInterval(120), DEFAULT_INTERVAL_SEC) // not an option
  assert.equal(normalizeInterval('900'), 900)
  assert.equal(normalizeInterval(undefined), DEFAULT_INTERVAL_SEC)
})

test('normalizeExpectedStatus clamps to a valid HTTP range', () => {
  assert.equal(normalizeExpectedStatus(204), 204)
  assert.equal(normalizeExpectedStatus('301'), 301)
  assert.equal(normalizeExpectedStatus(0), DEFAULT_EXPECTED_STATUS)
  assert.equal(normalizeExpectedStatus(700), DEFAULT_EXPECTED_STATUS)
  assert.equal(normalizeExpectedStatus('nope'), DEFAULT_EXPECTED_STATUS)
})

test('normalizeUrl accepts http(s), rejects everything else', () => {
  assert.equal(normalizeUrl('https://example.com'), 'https://example.com/')
  assert.equal(normalizeUrl('  http://api.example.com/health '), 'http://api.example.com/health')
  assert.equal(normalizeUrl('ftp://example.com'), null)
  assert.equal(normalizeUrl('file:///etc/passwd'), null)
  assert.equal(normalizeUrl('not a url'), null)
  assert.equal(normalizeUrl(''), null)
})

test('pingStatus is ok only on an exact code match', () => {
  assert.equal(pingStatus(200, 200), 'ok')
  assert.equal(pingStatus(503, 200), 'crit')
  assert.equal(pingStatus(200, 204), 'crit')
  assert.equal(pingStatus(null, 200), 'crit') // timeout / connection error
})

test('worstPingStatus is crit if any is crit', () => {
  assert.equal(worstPingStatus([]), 'ok')
  assert.equal(worstPingStatus(['ok', 'ok']), 'ok')
  assert.equal(worstPingStatus(['ok', 'crit']), 'crit')
})
