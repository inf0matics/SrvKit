import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from '../../lib/store.ts'

const sample = {
  targetId: 'target-1',
  name: 'Root configs',
  type: 'files',
  sourcePath: 'root',
  includes: ['configs', '.bashrc'],
  output: 'single',
  subdirectory: 'root',
  dateSuffix: false,
  timeSuffix: false,
}

test('starts with no jobs', () => {
  const s = openStore(':memory:')
  assert.deepEqual(s.listJobs(), [])
  s.close()
})

test('createJob returns a full record with id and createdAt', () => {
  const s = openStore(':memory:')
  const job = s.createJob(sample)
  assert.ok(job.id)
  assert.ok(job.createdAt)
  assert.equal(job.name, 'Root configs')
  assert.deepEqual(job.includes, ['configs', '.bashrc'])
  assert.equal(job.lastStatus, null) // never run yet
  assert.equal(job.active, false) // inactive until saved
  s.close()
})

test('setJobActive toggles the active flag', () => {
  const s = openStore(':memory:')
  const { id } = s.createJob(sample)
  assert.equal(s.getJob(id)?.active, false)
  s.setJobActive(id, true)
  assert.equal(s.getJob(id)?.active, true)
  s.close()
})

test('dateSuffix round-trips as a boolean', () => {
  const s = openStore(':memory:')
  const a = s.createJob({ ...sample, dateSuffix: true })
  assert.equal(a.dateSuffix, true)
  assert.equal(s.getJob(a.id)?.dateSuffix, true)
  s.updateJob(a.id, { ...sample, dateSuffix: false })
  assert.equal(s.getJob(a.id)?.dateSuffix, false)
  s.close()
})

test('recordRun stores the last run result', () => {
  const s = openStore(':memory:')
  const { id } = s.createJob(sample)
  s.recordRun(id, { at: '2026-06-25T03:12:00Z', status: 'failed', error: 'Upload failed' })
  const got = s.getJob(id)
  assert.equal(got?.lastStatus, 'failed')
  assert.equal(got?.lastRunAt, '2026-06-25T03:12:00Z')
  assert.equal(got?.lastError, 'Upload failed')

  s.recordRun(id, { at: '2026-06-25T04:00:00Z', status: 'success', error: null })
  assert.equal(s.getJob(id)?.lastStatus, 'success')
  assert.equal(s.getJob(id)?.lastError, null)
  s.close()
})

test('includes round-trip through JSON storage', () => {
  const s = openStore(':memory:')
  const { id } = s.createJob(sample)
  assert.deepEqual(s.getJob(id)?.includes, ['configs', '.bashrc'])
  assert.deepEqual(s.listJobs()[0]!.includes, ['configs', '.bashrc'])
  s.close()
})

test('empty includes are stored and read as []', () => {
  const s = openStore(':memory:')
  const { id } = s.createJob({ ...sample, includes: [] })
  assert.deepEqual(s.getJob(id)?.includes, [])
  s.close()
})

test('updateJob replaces the job fields', () => {
  const s = openStore(':memory:')
  const { id } = s.createJob(sample)
  assert.equal(
    s.updateJob(id, { ...sample, name: 'Renamed', includes: ['root/x'] }),
    true,
  )
  const got = s.getJob(id)
  assert.equal(got?.name, 'Renamed')
  assert.deepEqual(got?.includes, ['root/x'])
  s.close()
})

test('updateJob returns false for an unknown id', () => {
  const s = openStore(':memory:')
  assert.equal(s.updateJob('nope', sample), false)
  s.close()
})

test('deleteJob removes the row', () => {
  const s = openStore(':memory:')
  const { id } = s.createJob(sample)
  assert.equal(s.deleteJob(id), true)
  assert.deepEqual(s.listJobs(), [])
  assert.equal(s.deleteJob(id), false)
  s.close()
})
