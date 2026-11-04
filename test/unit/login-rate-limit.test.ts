import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'

const { loginRateLimit } = await import('../../server/utils/srvkit.ts')

const original = process.env.LOGIN_RATE_LIMIT

afterEach(() => {
  if (original === undefined) delete process.env.LOGIN_RATE_LIMIT
  else process.env.LOGIN_RATE_LIMIT = original
})

test('defaults to 10 attempts per minute', () => {
  delete process.env.LOGIN_RATE_LIMIT
  assert.equal(loginRateLimit(), 10)
})

test('honours a usable override', () => {
  process.env.LOGIN_RATE_LIMIT = '20'
  assert.equal(loginRateLimit(), 20)
})

test('falls back to the default rather than trusting a bad value', () => {
  // A typo must not silently disable the brute-force cap (0 or NaN would let
  // every attempt through) or invert it.
  for (const bad of ['', '   ', 'ten', '0', '-5', 'NaN', 'Infinity']) {
    process.env.LOGIN_RATE_LIMIT = bad
    assert.equal(loginRateLimit(), 10, `LOGIN_RATE_LIMIT=${JSON.stringify(bad)}`)
  }
})
