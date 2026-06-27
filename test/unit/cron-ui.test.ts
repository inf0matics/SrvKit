import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cronIsValid,
  cronNextRun,
  formatNextRun,
  cronNextLabel,
} from '../../app/utils/cron.ts'

// A date `daysAhead` calendar days from today at hh:mm (local).
function at(daysAhead: number, hh: number, mm: number): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead, hh, mm)
}

test('cronIsValid accepts valid expressions, rejects empty/garbage', () => {
  assert.equal(cronIsValid('0 3 * * *'), true)
  assert.equal(cronIsValid('*/5 * * * *'), true)
  assert.equal(cronIsValid(''), false)
  assert.equal(cronIsValid('not a cron'), false)
})

test('cronNextRun returns a future Date, or null when invalid', () => {
  const d = cronNextRun('0 3 * * *')
  assert.ok(d instanceof Date)
  assert.ok(d.getTime() > Date.now())
  assert.equal(cronNextRun(''), null)
  assert.equal(cronNextRun('bad'), null)
})

test('formatNextRun: today / tomorrow / DD.MM.YYYY', () => {
  assert.ok(formatNextRun(at(0, 3, 0)).startsWith('today '))
  assert.ok(formatNextRun(at(1, 3, 0)).startsWith('tomorrow '))
  assert.match(formatNextRun(at(5, 3, 0)), /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/)
})

test('formatNextRun honours an explicit timezone', () => {
  // 12:00 UTC renders as 12:00 in UTC and 14:00 in UTC+2 (Europe/Berlin, summer).
  const noonUtc = new Date('2026-07-15T12:00:00Z')
  assert.match(formatNextRun(noonUtc, 'UTC'), /12:00$/)
  assert.match(formatNextRun(noonUtc, 'Europe/Berlin'), /14:00$/)
})

test('cronNextLabel is empty for an invalid/empty expression', () => {
  assert.equal(cronNextLabel(''), '')
  assert.equal(cronNextLabel('garbage'), '')
  assert.ok(cronNextLabel('0 3 * * *').length > 0)
})
