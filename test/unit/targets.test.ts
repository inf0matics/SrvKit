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
