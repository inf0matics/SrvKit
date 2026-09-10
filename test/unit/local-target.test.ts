import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  chmodSync,
  existsSync,
  symlinkSync,
  utimesSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveInBase,
  testLocalDir,
  browseLocalDir,
  uploadLocalFile,
  listLocalFiles,
  deleteLocalFile,
} from '../../lib/local-target.ts'

function freshBase(): string {
  return mkdtempSync(join(tmpdir(), 'srvkit-localtarget-'))
}

/* ---- path containment ---- */

test('resolveInBase resolves a relative path under the base', () => {
  const base = freshBase()
  assert.equal(resolveInBase(base, 'nas/db'), join(base, 'nas/db'))
  assert.equal(resolveInBase(base, ''), base)
  rmSync(base, { recursive: true, force: true })
})

test('resolveInBase rejects paths escaping the base', () => {
  const base = freshBase()
  assert.equal(resolveInBase(base, '..'), null)
  assert.equal(resolveInBase(base, '../elsewhere'), null)
  assert.equal(resolveInBase(base, 'nas/../../etc'), null)
  assert.equal(resolveInBase(base, '/etc/passwd'), null)
  rmSync(base, { recursive: true, force: true })
})

test('resolveInBase does not treat a sibling with a shared prefix as inside', () => {
  const base = freshBase()
  // `<base>-evil` starts with `<base>` as a string but is not below it.
  assert.equal(resolveInBase(base, '../' + base.split('/').pop() + '-evil'), null)
  rmSync(base, { recursive: true, force: true })
})

/* ---- test() ---- */

test('testLocalDir reports a writable directory', () => {
  const base = freshBase()
  mkdirSync(join(base, 'nas'), { recursive: true })
  const res = testLocalDir(base, 'nas')
  assert.equal(res.ok, true)
  assert.match(res.message, /writable/i)
  // The probe file must not survive the test.
  assert.deepEqual(readdirSync(join(base, 'nas')), [])
  rmSync(base, { recursive: true, force: true })
})

test('testLocalDir rejects a path outside the allowed base', () => {
  const base = freshBase()
  const res = testLocalDir(base, '../..')
  assert.equal(res.ok, false)
  assert.match(res.message, /outside/i)
  rmSync(base, { recursive: true, force: true })
})

test('testLocalDir reports a missing directory', () => {
  const base = freshBase()
  const res = testLocalDir(base, 'nope')
  assert.equal(res.ok, false)
  assert.match(res.message, /not found/i)
  rmSync(base, { recursive: true, force: true })
})

test('testLocalDir reports a file where a directory is expected', () => {
  const base = freshBase()
  writeFileSync(join(base, 'afile'), 'x')
  const res = testLocalDir(base, 'afile')
  assert.equal(res.ok, false)
  assert.match(res.message, /not a directory/i)
  rmSync(base, { recursive: true, force: true })
})

test('testLocalDir reports a read-only directory', { skip: process.getuid?.() === 0 }, () => {
  const base = freshBase()
  const dir = join(base, 'ro')
  mkdirSync(dir)
  chmodSync(dir, 0o555)
  const res = testLocalDir(base, 'ro')
  assert.equal(res.ok, false)
  assert.match(res.message, /permission|read-only/i)
  chmodSync(dir, 0o755)
  rmSync(base, { recursive: true, force: true })
})

/* ---- browse() ---- */

test('browseLocalDir lists sub-directories only, sorted', () => {
  const base = freshBase()
  mkdirSync(join(base, 'srvkit'))
  mkdirSync(join(base, 'archive'))
  writeFileSync(join(base, 'notes.txt'), 'x')
  const res = browseLocalDir(base, '')
  assert.equal(res.ok, true)
  assert.deepEqual(res.dirs, ['archive', 'srvkit'])
  rmSync(base, { recursive: true, force: true })
})

test('browseLocalDir refuses to escape the base', () => {
  const base = freshBase()
  const res = browseLocalDir(base, '../..')
  assert.equal(res.ok, false)
  assert.match(res.message!, /outside/i)
  rmSync(base, { recursive: true, force: true })
})

test('browseLocalDir reports a missing folder', () => {
  const base = freshBase()
  const res = browseLocalDir(base, 'gone')
  assert.equal(res.ok, false)
  assert.match(res.message!, /not found/i)
  rmSync(base, { recursive: true, force: true })
})

/* ---- upload() ---- */

test('uploadLocalFile writes the archive and creates missing parents', () => {
  const base = freshBase()
  uploadLocalFile(base, 'nas/db/backup.tar.gz', Buffer.from('payload'))
  assert.equal(readFileSync(join(base, 'nas/db/backup.tar.gz'), 'utf8'), 'payload')
  rmSync(base, { recursive: true, force: true })
})

test('uploadLocalFile leaves no temporary file behind', () => {
  const base = freshBase()
  uploadLocalFile(base, 'dir/backup.tar.gz', Buffer.from('payload'))
  assert.deepEqual(readdirSync(join(base, 'dir')), ['backup.tar.gz'])
  rmSync(base, { recursive: true, force: true })
})

test('uploadLocalFile overwrites an existing archive of the same name', () => {
  const base = freshBase()
  uploadLocalFile(base, 'dir/backup.tar.gz', Buffer.from('old'))
  uploadLocalFile(base, 'dir/backup.tar.gz', Buffer.from('new'))
  assert.equal(readFileSync(join(base, 'dir/backup.tar.gz'), 'utf8'), 'new')
  assert.deepEqual(readdirSync(join(base, 'dir')), ['backup.tar.gz'])
  rmSync(base, { recursive: true, force: true })
})

test('uploadLocalFile refuses a destination outside the base', () => {
  const base = freshBase()
  assert.throws(() => uploadLocalFile(base, '../escape.tar.gz', Buffer.from('x')), /outside/i)
  assert.equal(existsSync(join(base, '../escape.tar.gz')), false)
  rmSync(base, { recursive: true, force: true })
})

/* ---- list() / delete() (used by retention, spec 19) ---- */

test('listLocalFiles returns file names only, not directories', () => {
  const base = freshBase()
  mkdirSync(join(base, 'dir/sub'), { recursive: true })
  writeFileSync(join(base, 'dir/a.tar.gz'), 'a')
  writeFileSync(join(base, 'dir/b.tar.gz'), 'b')
  assert.deepEqual(listLocalFiles(base, 'dir').sort(), ['a.tar.gz', 'b.tar.gz'])
  rmSync(base, { recursive: true, force: true })
})

test('listLocalFiles returns an empty list for a missing directory', () => {
  const base = freshBase()
  assert.deepEqual(listLocalFiles(base, 'nothing-here'), [])
  rmSync(base, { recursive: true, force: true })
})

test('listLocalFiles refuses to escape the base', () => {
  const base = freshBase()
  assert.throws(() => listLocalFiles(base, '../..'), /outside/i)
  rmSync(base, { recursive: true, force: true })
})

test('deleteLocalFile removes the file', () => {
  const base = freshBase()
  mkdirSync(join(base, 'dir'))
  writeFileSync(join(base, 'dir/old.tar.gz'), 'x')
  deleteLocalFile(base, 'dir/old.tar.gz')
  assert.equal(existsSync(join(base, 'dir/old.tar.gz')), false)
  rmSync(base, { recursive: true, force: true })
})

test('deleteLocalFile refuses to escape the base', () => {
  const base = freshBase()
  assert.throws(() => deleteLocalFile(base, '../../something'), /outside/i)
  rmSync(base, { recursive: true, force: true })
})

/* ---- the targets mount must exist; we never create it (review #1) ---- */

test('uploadLocalFile refuses to write when the base is not mounted', () => {
  const base = join(freshBase(), 'never-mounted')
  assert.throws(
    () => uploadLocalFile(base, 'db/backup.tar.gz', Buffer.from('x')),
    /not mounted/i,
  )
  // The whole point: the mount must not be conjured into existence.
  assert.equal(existsSync(base), false)
})

test('uploadLocalFile refuses when the base is a file, not a directory', () => {
  const base = freshBase()
  const asFile = join(base, 'afile')
  writeFileSync(asFile, 'x')
  assert.throws(() => uploadLocalFile(asFile, 'backup.tar.gz', Buffer.from('x')), /not mounted/i)
  rmSync(base, { recursive: true, force: true })
})

test('uploadLocalFile still creates directories below a mounted base', () => {
  const base = freshBase()
  uploadLocalFile(base, 'deep/nested/backup.tar.gz', Buffer.from('x'))
  assert.equal(readFileSync(join(base, 'deep/nested/backup.tar.gz'), 'utf8'), 'x')
  rmSync(base, { recursive: true, force: true })
})

/* ---- symlinks must not escape the mount (review #8) ---- */

test('resolveInBase rejects a path that escapes through a symlink', () => {
  const base = freshBase()
  const outside = freshBase()
  symlinkSync(outside, join(base, 'link'))
  assert.equal(resolveInBase(base, 'link'), null)
  assert.equal(resolveInBase(base, 'link/sub'), null)
  rmSync(base, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

test('resolveInBase still accepts a symlink that stays inside the mount', () => {
  const base = freshBase()
  mkdirSync(join(base, 'real'))
  symlinkSync(join(base, 'real'), join(base, 'inner'))
  assert.equal(resolveInBase(base, 'inner'), join(base, 'inner'))
  rmSync(base, { recursive: true, force: true })
})

test('a symlinked target root cannot be written through', () => {
  const base = freshBase()
  const outside = freshBase()
  symlinkSync(outside, join(base, 'link'))
  assert.throws(() => uploadLocalFile(base, 'link/backup.tar.gz', Buffer.from('x')), /outside/i)
  assert.equal(existsSync(join(outside, 'backup.tar.gz')), false)
  rmSync(base, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

/* ---- delete is idempotent, like the WebDAV driver (review #4) ---- */

test('deleteLocalFile treats an already-deleted file as success', () => {
  const base = freshBase()
  mkdirSync(join(base, 'dir'))
  // Retention only ever reduces to a count, so a file someone already removed
  // is the outcome we wanted — the same rule deleteWebdav applies to a 404.
  deleteLocalFile(base, 'dir/gone.tar.gz')
  rmSync(base, { recursive: true, force: true })
})

/* ---- stale temp archives are swept (review #14) ---- */

test('uploadLocalFile removes a stale temp archive left by a killed run', () => {
  const base = freshBase()
  mkdirSync(join(base, 'dir'))
  const stale = join(base, 'dir', '.backup.tar.gz.tmp-deadbeef0000')
  writeFileSync(stale, 'half-written')
  // Backdate it well past the sweep threshold.
  const old = new Date(Date.now() - 24 * 60 * 60 * 1000)
  utimesSync(stale, old, old)

  uploadLocalFile(base, 'dir/backup.tar.gz', Buffer.from('x'))

  assert.deepEqual(readdirSync(join(base, 'dir')), ['backup.tar.gz'])
  rmSync(base, { recursive: true, force: true })
})

test('uploadLocalFile leaves a fresh temp archive alone (a concurrent run owns it)', () => {
  const base = freshBase()
  mkdirSync(join(base, 'dir'))
  writeFileSync(join(base, 'dir', '.other.tar.gz.tmp-abc123abc123'), 'in flight')
  uploadLocalFile(base, 'dir/backup.tar.gz', Buffer.from('x'))
  assert.equal(readdirSync(join(base, 'dir')).length, 2)
  rmSync(base, { recursive: true, force: true })
})
