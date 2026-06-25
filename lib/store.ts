import { DatabaseSync } from 'node:sqlite'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * The whole of SrvKit's auth state lives in a single key/value `config` table:
 *
 *   password_hash   — bcrypt hash; absence of this key == "setup mode"
 *   session_secret  — random key used to seal session cookies. Rotated on every
 *                     password write, which instantly invalidates every cookie
 *                     sealed with the old secret ("all sessions invalidated").
 *
 * Only ever one password record. No user table, no roles (per spec).
 */
/** A backup target without its secret — safe to send to the client. */
export interface TargetSummary {
  id: string
  name: string
  host: string
  username: string
  /** Base path on the share; all jobs upload beneath it. */
  rootDir: string
  createdAt: string
}

/** A backup target including the encrypted password blob (server-only). */
export interface TargetRecord extends TargetSummary {
  password: string
}

export interface TargetInput {
  name: string
  host: string
  username: string
  /** Already-encrypted password blob. */
  password: string
  rootDir: string
}

export interface JobInput {
  targetId: string
  name: string
  /** 'files' is the only type in v1. */
  type: string
  /** Source path name under the mounted base (e.g. 'root'). */
  sourcePath: string
  /** Relative paths excluded from the backup. */
  excludes: string[]
  /** 'single' (one tar.gz) in v1. */
  output: string
  /** Sub-directory on the target where the archive is written. */
  subdirectory: string
}

export interface JobRecord extends JobInput {
  id: string
  createdAt: string
}

export interface Store {
  isInitialized(): boolean
  getPasswordHash(): string | null
  getSessionSecret(): string
  setPassword(hash: string): void
  listTargets(): TargetSummary[]
  getTarget(id: string): TargetRecord | null
  createTarget(input: TargetInput): TargetSummary
  updateTarget(id: string, fields: Partial<TargetInput>): boolean
  deleteTarget(id: string): boolean
  listJobs(): JobRecord[]
  getJob(id: string): JobRecord | null
  createJob(input: JobInput): JobRecord
  deleteJob(id: string): boolean
  close(): void
}

interface JobRow {
  id: string
  targetId: string
  name: string
  type: string
  sourcePath: string
  excludes: string
  output: string
  subdirectory: string
  createdAt: string
}

function rowToJob(row: JobRow): JobRecord {
  return { ...row, excludes: JSON.parse(row.excludes) as string[] }
}

interface ConfigRow {
  value: string
}

export function openStore(path: string): Store {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new DatabaseSync(path)
  // WAL so the long-lived server connection sees commits made by the separate
  // CLI process (change-password) without restarting.
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec(
    'CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  )
  db.exec(
    `CREATE TABLE IF NOT EXISTS targets (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       host TEXT NOT NULL,
       username TEXT NOT NULL,
       password TEXT NOT NULL,
       root_dir TEXT NOT NULL DEFAULT '',
       created_at TEXT NOT NULL
     )`,
  )
  // Migrate DBs created before root_dir existed.
  const targetCols = db.prepare('PRAGMA table_info(targets)').all() as {
    name: string
  }[]
  if (!targetCols.some((c) => c.name === 'root_dir')) {
    db.exec("ALTER TABLE targets ADD COLUMN root_dir TEXT NOT NULL DEFAULT ''")
  }
  db.exec(
    `CREATE TABLE IF NOT EXISTS jobs (
       id TEXT PRIMARY KEY,
       target_id TEXT NOT NULL,
       name TEXT NOT NULL,
       type TEXT NOT NULL,
       source_path TEXT NOT NULL,
       excludes TEXT NOT NULL DEFAULT '[]',
       output TEXT NOT NULL,
       subdirectory TEXT NOT NULL DEFAULT '',
       created_at TEXT NOT NULL
     )`,
  )

  const getStmt = db.prepare('SELECT value FROM config WHERE key = ?')
  const setStmt = db.prepare(
    `INSERT INTO config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )

  const get = (key: string): string | null => {
    const row = getStmt.get(key) as ConfigRow | undefined
    return row ? row.value : null
  }
  const set = (key: string, value: string): void => {
    setStmt.run(key, value)
  }

  // Ensure a session secret always exists, even before the password is set, so
  // cookie sealing has a stable key during setup mode.
  if (get('session_secret') === null) {
    set('session_secret', randomBytes(32).toString('hex'))
  }

  // --- Targets ---
  const listTargetsStmt = db.prepare(
    `SELECT id, name, host, username, root_dir AS rootDir, created_at AS createdAt
       FROM targets ORDER BY created_at`,
  )
  const getTargetStmt = db.prepare(
    `SELECT id, name, host, username, password, root_dir AS rootDir,
            created_at AS createdAt
       FROM targets WHERE id = ?`,
  )
  const insertTargetStmt = db.prepare(
    `INSERT INTO targets (id, name, host, username, password, root_dir, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const deleteTargetStmt = db.prepare('DELETE FROM targets WHERE id = ?')

  // --- Jobs ---
  const jobCols = `id, target_id AS targetId, name, type, source_path AS sourcePath,
                   excludes, output, subdirectory, created_at AS createdAt`
  const listJobsStmt = db.prepare(`SELECT ${jobCols} FROM jobs ORDER BY created_at`)
  const getJobStmt = db.prepare(`SELECT ${jobCols} FROM jobs WHERE id = ?`)
  const insertJobStmt = db.prepare(
    `INSERT INTO jobs
       (id, target_id, name, type, source_path, excludes, output, subdirectory, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const deleteJobStmt = db.prepare('DELETE FROM jobs WHERE id = ?')

  return {
    isInitialized: () => get('password_hash') !== null,
    getPasswordHash: () => get('password_hash'),
    getSessionSecret: () => get('session_secret')!,
    setPassword(hash: string) {
      set('password_hash', hash)
      // Rotate the sealing secret → every existing session cookie is now
      // unsealable and the user is effectively logged out everywhere.
      set('session_secret', randomBytes(32).toString('hex'))
    },

    listTargets: () => listTargetsStmt.all() as unknown as TargetSummary[],

    getTarget: (id: string) =>
      (getTargetStmt.get(id) as unknown as TargetRecord | undefined) ?? null,

    createTarget(input: TargetInput): TargetSummary {
      const id = randomUUID()
      const createdAt = new Date().toISOString()
      insertTargetStmt.run(
        id,
        input.name,
        input.host,
        input.username,
        input.password,
        input.rootDir,
        createdAt,
      )
      return {
        id,
        name: input.name,
        host: input.host,
        username: input.username,
        rootDir: input.rootDir,
        createdAt,
      }
    },

    updateTarget(id: string, fields: Partial<TargetInput>): boolean {
      const columns: Record<keyof TargetInput, string> = {
        name: 'name',
        host: 'host',
        username: 'username',
        password: 'password',
        rootDir: 'root_dir',
      }
      const sets: string[] = []
      const values: string[] = []
      for (const key of Object.keys(columns) as (keyof TargetInput)[]) {
        if (fields[key] !== undefined) {
          sets.push(`${columns[key]} = ?`)
          values.push(fields[key]!)
        }
      }
      if (sets.length === 0) return getTargetStmt.get(id) !== undefined
      const stmt = db.prepare(`UPDATE targets SET ${sets.join(', ')} WHERE id = ?`)
      return stmt.run(...values, id).changes > 0
    },

    deleteTarget: (id: string) => deleteTargetStmt.run(id).changes > 0,

    listJobs: () => (listJobsStmt.all() as unknown as JobRow[]).map(rowToJob),

    getJob(id: string) {
      const row = getJobStmt.get(id) as unknown as JobRow | undefined
      return row ? rowToJob(row) : null
    },

    createJob(input: JobInput): JobRecord {
      const id = randomUUID()
      const createdAt = new Date().toISOString()
      insertJobStmt.run(
        id,
        input.targetId,
        input.name,
        input.type,
        input.sourcePath,
        JSON.stringify(input.excludes),
        input.output,
        input.subdirectory,
        createdAt,
      )
      return { ...input, id, createdAt }
    },

    deleteJob: (id: string) => deleteJobStmt.run(id).changes > 0,

    close: () => db.close(),
  }
}
