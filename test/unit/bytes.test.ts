import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatBytes } from '../../app/utils/bytes.ts'

test('formats byte counts with a unit that stays readable', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(5), '5 B')
  assert.equal(formatBytes(1023), '1023 B')
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(1024 * 1024), '1.0 MB')
  assert.equal(formatBytes(4.2 * 1024 * 1024), '4.2 MB')
  assert.equal(formatBytes(3 * 1024 ** 3), '3.0 GB')
})

test('returns an empty string when there is no measurement', () => {
  assert.equal(formatBytes(null), '')
})
