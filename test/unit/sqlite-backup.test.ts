import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { backupSqliteFile, isSqliteFile, isWalDatabase } from '../../lib/sqlite-backup.ts'
import { listDbFiles } from '../../lib/sources.ts'

let base = ''

before(() => {
  base = mkdtempSync(join(tmpdir(), 'srvkit-sqlite-'))
  const db = new DatabaseSync(join(base, 'app.db'))
  db.exec('CREATE TABLE t(a)')
  db.prepare('INSERT INTO t VALUES (?)').run('x')
  db.prepare('INSERT INTO t VALUES (?)').run('y')
  db.close()
  // non-db files / dirs should be ignored by listDbFiles
  writeFileSync(join(base, 'notes.txt'), 'x')
})

after(() => rmSync(base, { recursive: true, force: true }))

test('listDbFiles returns only *.db files', () => {
  assert.deepEqual(listDbFiles(base), ['app.db'])
})

test('isSqliteFile detects the header magic', () => {
  assert.equal(isSqliteFile(join(base, 'app.db')), true)
  assert.equal(isSqliteFile(join(base, 'notes.txt')), false) // not a db
  assert.equal(isSqliteFile(join(base, 'missing.db')), false) // unreadable
})

test('backupSqliteFile produces a readable copy with the same rows', async () => {
  const dest = join(base, 'copy.db')
  await backupSqliteFile(join(base, 'app.db'), dest)
  assert.ok(existsSync(dest))
  const copy = new DatabaseSync(dest, { readOnly: true })
  const { c } = copy.prepare('SELECT count(*) AS c FROM t').get() as { c: number }
  copy.close()
  assert.equal(c, 2)
})

test('isWalDatabase detects a -wal/-shm sidecar', () => {
  assert.equal(isWalDatabase(join(base, 'app.db')), false) // journal mode, no sidecar
  writeFileSync(join(base, 'app.db-wal'), '')
  assert.equal(isWalDatabase(join(base, 'app.db')), true)
  rmSync(join(base, 'app.db-wal'))
  writeFileSync(join(base, 'app.db-shm'), '')
  assert.equal(isWalDatabase(join(base, 'app.db')), true)
})
