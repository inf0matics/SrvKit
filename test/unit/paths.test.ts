import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveWithin, isSafeRelPath } from '../../lib/paths.ts'

const fresh = () => mkdtempSync(join(tmpdir(), 'srvkit-paths-'))

test('resolveWithin keeps paths under the base', () => {
  const base = fresh()
  assert.equal(resolveWithin(base, 'a/b'), join(base, 'a/b'))
  assert.equal(resolveWithin(base, ''), base)
  rmSync(base, { recursive: true, force: true })
})

test('resolveWithin rejects lexical escapes', () => {
  const base = fresh()
  assert.equal(resolveWithin(base, '..'), null)
  assert.equal(resolveWithin(base, 'a/../../etc'), null)
  assert.equal(resolveWithin(base, '/etc/passwd'), null)
  rmSync(base, { recursive: true, force: true })
})

test('resolveWithin rejects an escape through a symlink', () => {
  const base = fresh()
  const outside = fresh()
  symlinkSync(outside, join(base, 'link'))
  assert.equal(resolveWithin(base, 'link/x'), null)
  rmSync(base, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

test('resolveWithin allows a symlink that stays inside', () => {
  const base = fresh()
  mkdirSync(join(base, 'real'))
  symlinkSync(join(base, 'real'), join(base, 'inner'))
  assert.equal(resolveWithin(base, 'inner/x'), join(base, 'inner/x'))
  rmSync(base, { recursive: true, force: true })
})

/* ---- isSafeRelPath: for paths we never touch the filesystem to check ---- */

test('isSafeRelPath accepts ordinary relative sub-paths', () => {
  assert.equal(isSafeRelPath(''), true, 'empty means "no sub-directory"')
  assert.equal(isSafeRelPath('db'), true)
  assert.equal(isSafeRelPath('db/nightly'), true)
  assert.equal(isSafeRelPath('a/../b'), true, 'normalizes to b — still inside')
})

test('isSafeRelPath rejects traversal and absolute paths', () => {
  assert.equal(isSafeRelPath('..'), false)
  assert.equal(isSafeRelPath('../etc'), false)
  assert.equal(isSafeRelPath('db/../../etc'), false)
  assert.equal(isSafeRelPath('/etc'), false)
})
