import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRateLimiter } from '../../lib/rateLimit.ts'

test('allows up to the limit then blocks with retry-after', () => {
  const rl = createRateLimiter(10, 60_000)
  const t0 = 1_000_000
  for (let i = 0; i < 10; i++) {
    assert.equal(rl.check('ip', t0 + i).allowed, true, `attempt ${i + 1}`)
  }
  const blocked = rl.check('ip', t0 + 10)
  assert.equal(blocked.allowed, false)
  assert.ok(blocked.retryAfter > 0 && blocked.retryAfter <= 60)
})

test('window slides — old hits expire', () => {
  const rl = createRateLimiter(10, 60_000)
  const t0 = 1_000_000
  for (let i = 0; i < 10; i++) rl.check('ip', t0)
  assert.equal(rl.check('ip', t0 + 30_000).allowed, false)
  // After the full window passes, the bucket is clear again.
  assert.equal(rl.check('ip', t0 + 60_001).allowed, true)
})

test('limits are per key (per IP)', () => {
  const rl = createRateLimiter(1, 60_000)
  assert.equal(rl.check('a', 0).allowed, true)
  assert.equal(rl.check('a', 0).allowed, false)
  assert.equal(rl.check('b', 0).allowed, true)
})
