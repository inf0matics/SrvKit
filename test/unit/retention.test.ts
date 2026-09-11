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

/* ---- rotation <-> column mapping, in both directions ---- */

const suffixes = (dateSuffix: boolean, timeSuffix: boolean) => ({ dateSuffix, timeSuffix })

test('Off leaves the filename suffixes to the user and never deletes', () => {
  assert.deepEqual(retentionColumns('off', 7, suffixes(false, false)), {
    rotation: 'off',
    dateSuffix: false,
    timeSuffix: false,
    keepVersions: 0,
  })
  assert.deepEqual(retentionColumns('off', 7, suffixes(true, false)), {
    rotation: 'off',
    dateSuffix: true,
    timeSuffix: false,
    keepVersions: 0,
  })
  assert.deepEqual(retentionColumns('off', 7, suffixes(true, true)), {
    rotation: 'off',
    dateSuffix: true,
    timeSuffix: true,
    keepVersions: 0,
  })
})

test('a time suffix without a date is dropped — it cannot stand on its own', () => {
  assert.deepEqual(retentionColumns('off', 0, suffixes(false, true)), {
    rotation: 'off',
    dateSuffix: false,
    timeSuffix: false,
    keepVersions: 0,
  })
})

test('both keep modes force date and time on, so every run is its own file', () => {
  assert.deepEqual(retentionColumns('all', 7, suffixes(false, false)), {
    rotation: 'all',
    dateSuffix: true,
    timeSuffix: true,
    keepVersions: 0,
  })
  assert.deepEqual(retentionColumns('keep', 7, suffixes(false, false)), {
    rotation: 'keep',
    dateSuffix: true,
    timeSuffix: true,
    keepVersions: 7,
  })
})

test('keep below the minimum is raised to it, never silently disabled', () => {
  assert.equal(retentionColumns('keep', 1, suffixes(true, true)).keepVersions, 2)
  assert.equal(retentionColumns('keep', 0, suffixes(true, true)).keepVersions, 2)
})

test('the stored rotation is what the form reads back', () => {
  assert.equal(retentionMode('off'), 'off')
  assert.equal(retentionMode('all'), 'all')
  assert.equal(retentionMode('keep'), 'keep')
})

test('an unknown or missing rotation falls back to off, which deletes nothing', () => {
  assert.equal(retentionMode(''), 'off')
  assert.equal(retentionMode('nonsense'), 'off')
})

test('every mode round-trips through the columns and back', () => {
  for (const mode of ['off', 'all', 'keep'] as const) {
    const cols = retentionColumns(mode, 7, suffixes(true, true))
    assert.equal(retentionMode(cols.rotation), mode, mode)
  }
})

/* ---- what the API must refuse ---- */

const valid = (o: Partial<Parameters<typeof isValidRetention>[0]>) =>
  isValidRetention({
    rotation: 'off',
    dateSuffix: false,
    timeSuffix: false,
    keepVersions: 0,
    ...o,
  })

test('accepts every shape the form can produce', () => {
  assert.equal(valid({}), true)
  assert.equal(valid({ dateSuffix: true }), true)
  assert.equal(valid({ dateSuffix: true, timeSuffix: true }), true)
  assert.equal(
    valid({ rotation: 'all', dateSuffix: true, timeSuffix: true }),
    true,
  )
  assert.equal(
    valid({ rotation: 'keep', dateSuffix: true, timeSuffix: true, keepVersions: 2 }),
    true,
  )
})

test('rejects a time suffix without a date', () => {
  assert.equal(valid({ timeSuffix: true }), false)
})

test('rejects keeping versions without the dated filename that makes them', () => {
  assert.equal(valid({ rotation: 'keep', keepVersions: 7 }), false)
  assert.equal(
    valid({ rotation: 'keep', dateSuffix: true, timeSuffix: true, keepVersions: 1 }),
    false,
  )
})

test('rejects a keep count on a rotation that never deletes', () => {
  // Otherwise a stale client could store a count that silently does nothing.
  assert.equal(valid({ rotation: 'off', dateSuffix: true, keepVersions: 7 }), false)
  assert.equal(
    valid({ rotation: 'all', dateSuffix: true, timeSuffix: true, keepVersions: 7 }),
    false,
  )
})

test('rejects an unknown rotation outright', () => {
  assert.equal(valid({ rotation: 'sometimes' }), false)
})
