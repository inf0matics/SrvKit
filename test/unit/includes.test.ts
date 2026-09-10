import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = mkdtempSync(join(tmpdir(), 'srvkit-inc-'))
process.env.DATABASE_PATH = join(base, 'db.sqlite')
process.env.ENCRYPTION_KEY = 'inc-key'
process.env.BACKUP_SOURCES_DIR = join(base, 'sources')

const { isSafeInclude } = await import('../../server/utils/backups.ts')

test('accepts relative paths that stay inside the source dir', () => {
  assert.ok(isSafeInclude('configs'))
  assert.ok(isSafeInclude('configs/app.conf'))
  assert.ok(isSafeInclude('.bashrc'))
  assert.ok(isSafeInclude('a/b/c'))
  assert.ok(isSafeInclude('a/../b')) // normalizes to 'b' — still inside
})

test('rejects traversal and absolute paths', () => {
  assert.equal(isSafeInclude('../etc/passwd'), false)
  assert.equal(isSafeInclude('../../etc/passwd'), false)
  assert.equal(isSafeInclude('a/../../b'), false) // normalizes to '../b'
  assert.equal(isSafeInclude('/etc/passwd'), false)
  assert.equal(isSafeInclude('..'), false)
  assert.equal(isSafeInclude(''), false)
})

/* ---- source paths must not escape through a symlink either ---- */

const { resolveSourcePath } = await import('../../server/utils/backups.ts')

test('resolveSourcePath rejects a lexical escape', () => {
  assert.equal(resolveSourcePath('..'), null)
  assert.equal(resolveSourcePath('root/../../etc'), null)
})

test('resolveSourcePath rejects an escape through a symlink', async () => {
  const { mkdirSync, symlinkSync, rmSync } = await import('node:fs')
  const outside = join(base, 'outside')
  mkdirSync(join(base, 'sources'), { recursive: true })
  mkdirSync(outside, { recursive: true })
  const link = join(base, 'sources', 'escape')
  rmSync(link, { force: true })
  symlinkSync(outside, link)
  assert.equal(resolveSourcePath('escape'), null)
  assert.equal(resolveSourcePath('escape/secrets'), null)
})
