import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from '../../lib/store.ts'

const sample = {
  targetId: 'target-1',
  name: 'Root configs',
  type: 'files',
  sourcePath: 'root',
  excludes: ['root/.cache', 'root/tmp/x.log'],
  output: 'single',
  subdirectory: 'root',
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
  assert.deepEqual(job.excludes, ['root/.cache', 'root/tmp/x.log'])
  s.close()
})

test('excludes round-trip through JSON storage', () => {
  const s = openStore(':memory:')
  const { id } = s.createJob(sample)
  assert.deepEqual(s.getJob(id)?.excludes, ['root/.cache', 'root/tmp/x.log'])
  assert.deepEqual(s.listJobs()[0]!.excludes, ['root/.cache', 'root/tmp/x.log'])
  s.close()
})

test('empty excludes are stored and read as []', () => {
  const s = openStore(':memory:')
  const { id } = s.createJob({ ...sample, excludes: [] })
  assert.deepEqual(s.getJob(id)?.excludes, [])
  s.close()
})

test('updateJob replaces the job fields', () => {
  const s = openStore(':memory:')
  const { id } = s.createJob(sample)
  assert.equal(
    s.updateJob(id, { ...sample, name: 'Renamed', excludes: ['root/x'] }),
    true,
  )
  const got = s.getJob(id)
  assert.equal(got?.name, 'Renamed')
  assert.deepEqual(got?.excludes, ['root/x'])
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
