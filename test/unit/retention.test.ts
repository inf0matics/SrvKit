import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  archivesToDelete,
  retentionColumns,
  retentionMode,
  isValidRetention,
} from '../../lib/retention.ts'

/* ---- picking the newest N ---- */

test('keeps the N newest and deletes the rest', () => {
  const files = [
    'db_2026-09-06.tar.gz',
    'db_2026-09-07.tar.gz',
    'db_2026-09-08.tar.gz',
    'db_2026-09-09.tar.gz',
    'db_2026-09-10.tar.gz',
  ]
  assert.deepEqual(archivesToDelete(files, 'db', 3).sort(), [
    'db_2026-09-06.tar.gz',
    'db_2026-09-07.tar.gz',
  ])
})

test('ordering follows the timestamp in the name, not the listing order', () => {
  const files = [
    'db_2026-09-10.tar.gz',
    'db_2026-01-01.tar.gz',
    'db_2026-12-31.tar.gz',
  ]
  assert.deepEqual(archivesToDelete(files, 'db', 2), ['db_2026-01-01.tar.gz'])
})

test('date-only and date+time names sort correctly when mixed', () => {
  const files = [
    'db_2026-09-10_03-00-00.tar.gz', // newest
    'db_2026-09-10.tar.gz', // same day, start of day → second
    'db_2026-09-09_23-59-59.tar.gz', // oldest, despite the late time
  ]
  // The date-only archive sorts between the two timed ones.
  assert.deepEqual(archivesToDelete(files, 'db', 2), ['db_2026-09-09_23-59-59.tar.gz'])
})

test('deletes nothing when there are fewer archives than N', () => {
  const files = ['db_2026-09-09.tar.gz', 'db_2026-09-10.tar.gz']
  assert.deepEqual(archivesToDelete(files, 'db', 7), [])
})

test('deletes nothing when there are exactly N archives', () => {
  const files = ['db_2026-09-09.tar.gz', 'db_2026-09-10.tar.gz']
  assert.deepEqual(archivesToDelete(files, 'db', 2), [])
})

/* ---- off ---- */

test('keep 0 deletes nothing', () => {
  const files = ['db_2026-09-09.tar.gz', 'db_2026-09-10.tar.gz']
  assert.deepEqual(archivesToDelete(files, 'db', 0), [])
})

test('a keep count below the minimum of 2 is treated as off, not as delete more', () => {
  const files = ['db_2026-09-08.tar.gz', 'db_2026-09-09.tar.gz', 'db_2026-09-10.tar.gz']
  assert.deepEqual(archivesToDelete(files, 'db', 1), [])
  assert.deepEqual(archivesToDelete(files, 'db', -3), [])
})

/* ---- what counts as a version: anchored at both ends ---- */

test('ignores archives belonging to another job in the same directory', () => {
  const files = [
    'db_2026-09-08.tar.gz',
    'db_2026-09-09.tar.gz',
    'db_2026-09-10.tar.gz',
    'other_2026-01-01.tar.gz',
    'other_2026-01-02.tar.gz',
  ]
  assert.deepEqual(archivesToDelete(files, 'db', 2), ['db_2026-09-08.tar.gz'])
})

test('a prefix-overlapping job name is not a match', () => {
  const files = [
    'db_2026-09-09.tar.gz',
    'db_2026-09-10.tar.gz',
    'db-old_2026-01-01.tar.gz',
    'db-old_2026-01-02.tar.gz',
    'db_backup_2026-01-01.tar.gz',
  ]
  assert.deepEqual(archivesToDelete(files, 'db', 2), [])
})

test('ignores names that are not this job archive pattern', () => {
  const files = [
    'db_2026-09-09.tar.gz',
    'db_2026-09-10.tar.gz',
    'db_notes.tar.gz',
    'db.tar.gz',
    'db_2026-09-11.tar.gz.part',
    'db_2026-9-1.tar.gz', // not zero-padded
    'db_2026-09-12.zip',
    'prefix_db_2026-09-13.tar.gz',
  ]
  assert.deepEqual(archivesToDelete(files, 'db', 2), [])
})

test('a job name containing regex metacharacters is matched literally', () => {
  const files = [
    'a.b_2026-09-08.tar.gz',
    'a.b_2026-09-09.tar.gz',
    'a.b_2026-09-10.tar.gz',
    'axb_2026-09-01.tar.gz', // '.' must not act as a wildcard
  ]
  assert.deepEqual(archivesToDelete(files, 'a.b', 2), ['a.b_2026-09-08.tar.gz'])
})

test('a job name with spaces and brackets is matched literally', () => {
  const files = [
    'App DB (prod)_2026-09-08.tar.gz',
    'App DB (prod)_2026-09-09.tar.gz',
    'App DB (prod)_2026-09-10.tar.gz',
  ]
  assert.deepEqual(archivesToDelete(files, 'App DB (prod)', 2), [
    'App DB (prod)_2026-09-08.tar.gz',
  ])
})

/* ---- the archive just written is never a deletion candidate ---- */

test('the current run archive is never deleted, even with an odd timestamp', () => {
  const files = [
    'db_2026-09-08.tar.gz',
    'db_2026-09-09.tar.gz',
    'db_2026-09-10.tar.gz',
    'db_1999-01-01.tar.gz', // the run just wrote this one, clock skew and all
  ]
  const deleted = archivesToDelete(files, 'db', 2, 'db_1999-01-01.tar.gz')
  assert.ok(!deleted.includes('db_1999-01-01.tar.gz'))
  assert.deepEqual(deleted.sort(), ['db_2026-09-08.tar.gz', 'db_2026-09-09.tar.gz'])
})

/* ---- idempotent: reducing to the target count, not "the one extra file" ---- */

test('trims a large backlog to exactly N in one pass', () => {
  const files = Array.from({ length: 30 }, (_, i) => {
    const day = String(i + 1).padStart(2, '0')
    return `db_2026-09-${day}.tar.gz`
  })
  const deleted = archivesToDelete(files, 'db', 7)
  assert.equal(deleted.length, 23)
  assert.ok(!deleted.includes('db_2026-09-30.tar.gz'))
  assert.ok(deleted.includes('db_2026-09-23.tar.gz'))
  assert.ok(!deleted.includes('db_2026-09-24.tar.gz'))
})

test('running again on an already-trimmed directory deletes nothing', () => {
  const files = ['db_2026-09-09.tar.gz', 'db_2026-09-10.tar.gz']
  const remaining = files.filter((f) => !archivesToDelete(files, 'db', 2).includes(f))
  assert.deepEqual(archivesToDelete(remaining, 'db', 2), [])
})

/* ---- the mode <-> column mapping, in both directions ---- */

test('each mode maps onto the columns that implement it', () => {
  assert.deepEqual(retentionColumns('overwrite', 7), { dateSuffix: false, keepVersions: 0 })
  assert.deepEqual(retentionColumns('keep-all', 7), { dateSuffix: true, keepVersions: 0 })
  assert.deepEqual(retentionColumns('keep-n', 7), { dateSuffix: true, keepVersions: 7 })
})

test('keep-n below the minimum is raised to it, never silently disabled', () => {
  assert.deepEqual(retentionColumns('keep-n', 1), { dateSuffix: true, keepVersions: 2 })
  assert.deepEqual(retentionColumns('keep-n', 0), { dateSuffix: true, keepVersions: 2 })
})

test('stored columns render the mode they came from', () => {
  assert.equal(retentionMode(false, 0), 'overwrite')
  assert.equal(retentionMode(true, 0), 'keep-all')
  assert.equal(retentionMode(true, 7), 'keep-n')
})

test('an existing job reads as the mode it already behaves like', () => {
  // Every job that predates retention has keepVersions 0.
  assert.equal(retentionMode(false, 0), 'overwrite', 'date suffix off = overwrite')
  assert.equal(retentionMode(true, 0), 'keep-all', 'date suffix on = keep all')
})

test('the unreachable combination is read as overwrite, which is what it does', () => {
  // keepVersions >= 2 with no date suffix means one static filename: nothing
  // ever accumulates, so nothing is ever deleted.
  assert.equal(retentionMode(false, 7), 'overwrite')
})

test('every mode round-trips through the columns and back', () => {
  for (const mode of ['overwrite', 'keep-all', 'keep-n'] as const) {
    const cols = retentionColumns(mode, 7)
    assert.equal(retentionMode(cols.dateSuffix, cols.keepVersions), mode, mode)
  }
})

/* ---- what the API must refuse ---- */

test('keeping versions without a date suffix is rejected', () => {
  // Unreachable through the UI, but a stale client must not create a job that
  // silently never cleans up.
  assert.equal(isValidRetention(false, 0), true)
  assert.equal(isValidRetention(true, 0), true)
  assert.equal(isValidRetention(true, 2), true)
  assert.equal(isValidRetention(false, 2), false)
  assert.equal(isValidRetention(false, 7), false)
})

test('a keep count of 1 is rejected — that is overwriting under another name', () => {
  assert.equal(isValidRetention(true, 1), false)
  assert.equal(isValidRetention(true, -1), false)
})

test('a current archive missing from the listing keeps one extra, never one too few', () => {
  // Read-after-write lag on the target: the archive this run just wrote is not
  // in the listing yet. Erring toward keeping is the only safe direction.
  const files = [
    'db_2026-09-08.tar.gz',
    'db_2026-09-09.tar.gz',
    'db_2026-09-10.tar.gz',
  ]
  const deleted = archivesToDelete(files, 'db', 2, 'db_2026-09-11.tar.gz')
  assert.deepEqual(deleted, ['db_2026-09-08.tar.gz'])
  // Two listed survivors plus the unlisted new one = 3 on disk, not 2. The
  // next run sees all four and trims to the configured count.
  assert.equal(files.length - deleted.length, 2)
})
