import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateBackupStatus } from '../../lib/backup-status.ts'

test('no jobs → null (no badge)', () => {
  assert.equal(aggregateBackupStatus([]), null)
})

test('all jobs OK or never run → ok', () => {
  assert.equal(
    aggregateBackupStatus([{ lastStatus: 'success' }, { lastStatus: null }]),
    'ok',
  )
})

test('any job last run failed → error', () => {
  assert.equal(
    aggregateBackupStatus([{ lastStatus: 'success' }, { lastStatus: 'failed' }]),
    'error',
  )
})
