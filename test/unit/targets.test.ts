import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from '../../lib/store.ts'

const sample = {
  name: 'My Nextcloud',
  host: 'https://nc.example.com',
  username: 'alice',
  password: 'encrypted-blob',
  rootDir: 'srvkit',
}

test('starts with no targets', () => {
  const s = openStore(':memory:')
  assert.deepEqual(s.listTargets(), [])
  s.close()
})

test('createTarget returns a summary without the password', () => {
  const s = openStore(':memory:')
  const created = s.createTarget(sample)
  assert.ok(created.id)
  assert.equal(created.name, 'My Nextcloud')
  assert.equal(created.rootDir, 'srvkit')
  assert.ok(created.createdAt)
  assert.ok(!('password' in created))
  s.close()
})

test('rootDir round-trips through list and get', () => {
  const s = openStore(':memory:')
  const { id } = s.createTarget(sample)
  assert.equal(s.listTargets()[0]!.rootDir, 'srvkit')
  assert.equal(s.getTarget(id)?.rootDir, 'srvkit')
  s.updateTarget(id, { rootDir: 'backups/prod' })
  assert.equal(s.getTarget(id)?.rootDir, 'backups/prod')
  s.close()
})

test('listTargets never exposes the password blob', () => {
  const s = openStore(':memory:')
  s.createTarget(sample)
  const list = s.listTargets()
  assert.equal(list.length, 1)
  assert.ok(!('password' in list[0]!))
  s.close()
})

test('getTarget returns the full record including the encrypted password', () => {
  const s = openStore(':memory:')
  const { id } = s.createTarget(sample)
  const got = s.getTarget(id)
  assert.equal(got?.password, 'encrypted-blob')
  s.close()
})

test('getTarget returns null for an unknown id', () => {
  const s = openStore(':memory:')
  assert.equal(s.getTarget('nope'), null)
  s.close()
})

test('updateTarget patches selected fields only', () => {
  const s = openStore(':memory:')
  const { id } = s.createTarget(sample)
  assert.equal(s.updateTarget(id, { name: 'Renamed' }), true)
  const got = s.getTarget(id)
  assert.equal(got?.name, 'Renamed')
  assert.equal(got?.host, sample.host) // untouched
  assert.equal(got?.password, 'encrypted-blob') // untouched
  s.close()
})

test('updateTarget can rotate the password blob', () => {
  const s = openStore(':memory:')
  const { id } = s.createTarget(sample)
  s.updateTarget(id, { password: 'new-blob' })
  assert.equal(s.getTarget(id)?.password, 'new-blob')
  s.close()
})

test('updateTarget returns false for an unknown id', () => {
  const s = openStore(':memory:')
  assert.equal(s.updateTarget('nope', { name: 'x' }), false)
  s.close()
})

test('deleteTarget removes the row', () => {
  const s = openStore(':memory:')
  const { id } = s.createTarget(sample)
  assert.equal(s.deleteTarget(id), true)
  assert.deepEqual(s.listTargets(), [])
  assert.equal(s.deleteTarget(id), false) // already gone
  s.close()
})

/* ---- target type (spec 18: local directory targets) ---- */

const localSample = {
  name: 'Local disk',
  type: 'local',
  host: '',
  username: '',
  password: '',
  rootDir: 'nas/db',
}

test('a target created without a type is a nextcloud target', () => {
  const s = openStore(':memory:')
  const created = s.createTarget(sample)
  assert.equal(created.type, 'nextcloud')
  assert.equal(s.getTarget(created.id)?.type, 'nextcloud')
  assert.equal(s.listTargets()[0]!.type, 'nextcloud')
  s.close()
})

test('a local target round-trips its type and keeps no credentials', () => {
  const s = openStore(':memory:')
  const { id } = s.createTarget(localSample)
  const got = s.getTarget(id)!
  assert.equal(got.type, 'local')
  assert.equal(got.host, '')
  assert.equal(got.username, '')
  assert.equal(got.password, '')
  assert.equal(got.rootDir, 'nas/db')
  assert.equal(s.listTargets()[0]!.type, 'local')
  s.close()
})

test('updateTarget cannot change a target type', () => {
  const s = openStore(':memory:')
  const { id } = s.createTarget(localSample)
  s.updateTarget(id, { type: 'nextcloud', rootDir: 'other' } as Partial<typeof localSample>)
  const got = s.getTarget(id)!
  assert.equal(got.type, 'local', 'type must stay as created')
  assert.equal(got.rootDir, 'other', 'other fields still update')
  s.close()
})

/* ---- a target root must not climb out of the share ---- */

test('normalizeRoot leaves a traversing root visible to validation', async () => {
  const { normalizeRoot, isSafeTargetRoot } = await import('../../server/utils/backups.ts')
  // Stripping slashes is not sanitising — the caller must still validate.
  assert.equal(isSafeTargetRoot(normalizeRoot('/srvkit/')), true)
  assert.equal(isSafeTargetRoot(normalizeRoot('srvkit/nested')), true)
  assert.equal(isSafeTargetRoot(normalizeRoot('')), true)
  assert.equal(isSafeTargetRoot(normalizeRoot('../../etc')), false)
  assert.equal(isSafeTargetRoot(normalizeRoot('srvkit/../../etc')), false)
})
