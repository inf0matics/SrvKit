import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../../lib/store.ts'

/**
 * SrvKit has no migration framework: the ALTER TABLE guards in openStore() ARE
 * the upgrade mechanism, and users upgrade by pulling a new image. Every other
 * store test opens `:memory:`, which takes the CREATE TABLE branch and never
 * executes those guards — so this is the only test that covers what actually
 * happens to a database that already exists on a volume.
 */

/** The schema exactly as it shipped before local targets and retention. */
const PREVIOUS_SCHEMA = `
  CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE targets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    root_dir TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    source_path TEXT NOT NULL DEFAULT '',
    includes TEXT NOT NULL DEFAULT '[]',
    output TEXT NOT NULL DEFAULT 'single',
    subdirectory TEXT NOT NULL DEFAULT '',
    date_suffix INTEGER NOT NULL DEFAULT 0,
    time_suffix INTEGER NOT NULL DEFAULT 0,
    "trigger" TEXT NOT NULL DEFAULT 'filewatcher',
    container TEXT NOT NULL DEFAULT '',
    database TEXT NOT NULL DEFAULT '',
    db_user TEXT NOT NULL DEFAULT '',
    db_password TEXT NOT NULL DEFAULT '',
    schedule TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 0,
    alert_state TEXT NOT NULL DEFAULT 'ok',
    incident_since TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_run_at TEXT,
    last_status TEXT,
    last_error TEXT,
    last_bytes INTEGER,
    failed_runs INTEGER NOT NULL DEFAULT 0,
    last_success_at TEXT,
    last_alert_at TEXT
  );
`

/** A database file holding one target and one job from the previous release. */
function previousRelease(): string {
  const dir = mkdtempSync(join(tmpdir(), 'srvkit-upgrade-'))
  const path = join(dir, 'srvkit.db')
  const db = new DatabaseSync(path)
  db.exec(PREVIOUS_SCHEMA)
  db.prepare(
    `INSERT INTO targets (id, name, host, username, password, root_dir, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('t1', 'My Nextcloud', 'https://nc.example.com', 'alice', 'blob', 'srvkit', '2026-01-01')
  db.prepare(
    `INSERT INTO jobs (id, target_id, name, type, subdirectory, date_suffix, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('j1', 't1', 'Root configs', 'files', 'root', 1, '2026-01-01')
  db.close()
  return path
}

test('an existing database upgrades in place, with no manual step', () => {
  const path = previousRelease()
  const s = openStore(path)

  const target = s.getTarget('t1')!
  assert.equal(target.type, 'nextcloud', 'every pre-existing target is a Nextcloud target')
  assert.equal(target.host, 'https://nc.example.com')
  assert.equal(target.rootDir, 'srvkit')

  const job = s.getJob('j1')!
  assert.equal(job.keepVersions, 0, 'no cleanup, exactly as before')
  assert.equal(job.lastCleanupError, null)
  assert.equal(job.dateSuffix, true, 'the existing filename scheme is untouched')

  s.close()
  rmSync(path, { force: true })
})

test('an upgraded row keeps behaving as it did — a dated job is unmanaged', async () => {
  const { retentionMode } = await import('../../lib/retention.ts')
  const path = previousRelease()
  const s = openStore(path)
  const job = s.getJob('j1')!
  // One dated file per day and nothing ever deleted: SrvKit was not rotating
  // this job before the upgrade, and it must not start now.
  assert.equal(retentionMode(job.rotation), 'off')
  assert.equal(job.dateSuffix, true, 'its filename scheme is untouched')
  assert.equal(job.keepVersions, 0)
  s.close()
  rmSync(path, { force: true })
})

test('opening an already-upgraded database again is a no-op', () => {
  const path = previousRelease()
  openStore(path).close()
  // The second open must not re-run ADD COLUMN (SQLite would throw "duplicate
  // column name") — this is the every-restart path, not a one-off.
  const s = openStore(path)
  assert.equal(s.getTarget('t1')?.type, 'nextcloud')
  assert.equal(s.getJob('j1')?.keepVersions, 0)
  s.close()
  rmSync(path, { force: true })
})

test('a target created after the upgrade can be a local one', () => {
  const path = previousRelease()
  const s = openStore(path)
  const local = s.createTarget({
    name: 'Local disk',
    type: 'local',
    host: '',
    username: '',
    password: '',
    rootDir: 'nas',
  })
  assert.equal(local.type, 'local')
  assert.equal(s.listTargets().length, 2)
  s.close()
  rmSync(path, { force: true })
})

test('existing jobs get a rotation that matches what they already do', async () => {
  const { DatabaseSync: DB } = await import('node:sqlite')
  const path = previousRelease()
  // Three shapes from before rotation existed, written with the old schema.
  const db = new DB(path)
  db.exec("ALTER TABLE jobs ADD COLUMN keep_versions INTEGER NOT NULL DEFAULT 0")
  const ins = db.prepare(
    `INSERT INTO jobs (id, target_id, name, type, created_at, date_suffix, time_suffix, keep_versions)
     VALUES (?, 't1', ?, 'files', '2026-01-01', ?, ?, ?)`,
  )
  ins.run('j-plain', 'Plain', 0, 0, 0) // one static file
  ins.run('j-dated', 'Dated', 1, 0, 0) // a file per day
  ins.run('j-full', 'Full', 1, 1, 0) // a file per run
  ins.run('j-keep', 'Keeper', 1, 1, 5) // already trimming
  db.close()

  const s = openStore(path)
  // Nothing SrvKit manages -> off, and the suffixes are left exactly as they were.
  assert.equal(s.getJob('j-plain')?.rotation, 'off')
  assert.equal(s.getJob('j-dated')?.rotation, 'off')
  assert.equal(s.getJob('j-dated')?.dateSuffix, true)
  assert.equal(s.getJob('j-dated')?.timeSuffix, false)
  // Already one file per run with no trimming — that is exactly "keep all".
  assert.equal(s.getJob('j-full')?.rotation, 'all')
  // Already trimming to a count.
  assert.equal(s.getJob('j-keep')?.rotation, 'keep')
  assert.equal(s.getJob('j-keep')?.keepVersions, 5)
  s.close()
  rmSync(path, { force: true })
})
