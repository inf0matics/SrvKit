import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from '../../lib/store.ts'

test('starts in setup mode (no password)', () => {
  const s = openStore(':memory:')
  assert.equal(s.isInitialized(), false)
  assert.equal(s.getPasswordHash(), null)
  s.close()
})

test('setPassword marks initialized and stores the hash', () => {
  const s = openStore(':memory:')
  s.setPassword('$2b$12$fakehashvalue')
  assert.equal(s.isInitialized(), true)
  assert.equal(s.getPasswordHash(), '$2b$12$fakehashvalue')
  s.close()
})

test('a session secret always exists, even in setup mode', () => {
  const s = openStore(':memory:')
  assert.match(s.getSessionSecret(), /^[0-9a-f]{64}$/)
  s.close()
})

test('setPassword rotates the session secret (invalidates sessions)', () => {
  const s = openStore(':memory:')
  const before = s.getSessionSecret()
  s.setPassword('$2b$12$one')
  const afterFirst = s.getSessionSecret()
  s.setPassword('$2b$12$two')
  const afterSecond = s.getSessionSecret()
  assert.notEqual(before, afterFirst)
  assert.notEqual(afterFirst, afterSecond)
  s.close()
})
