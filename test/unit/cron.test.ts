import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isValidCron, nextRun } from '../../lib/cron.ts'

test('isValidCron accepts valid expressions, rejects empty/garbage', () => {
  assert.equal(isValidCron('0 3 * * *'), true)
  assert.equal(isValidCron('*/5 * * * *'), true)
  assert.equal(isValidCron(''), false)
  assert.equal(isValidCron('   '), false)
  assert.equal(isValidCron('not a cron'), false)
})

test('nextRun returns a future ISO timestamp, or null when invalid', () => {
  const next = nextRun('0 3 * * *')
  assert.ok(next)
  assert.ok(new Date(next!).getTime() > Date.now())
  assert.equal(nextRun(''), null)
  assert.equal(nextRun('garbage'), null)
})
