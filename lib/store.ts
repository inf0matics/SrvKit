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
  /** 'files' or 'sqlite'. */
  type: string
  /** Source path under the mounted base — a directory ('root') or a .db file. */
  sourcePath: string
  /** Selected paths to back up, relative to the source dir (Files jobs). */
  includes: string[]
  /** 'single' (one tar.gz) in v1. */
  output: string
  /** Sub-directory on the target where the archive is written. */
  subdirectory: string
  /** Append _YYYY-MM-DD to the archive filename. */
  dateSuffix: boolean
  /** Append _HH-MM-SS to the archive filename. */
  timeSuffix: boolean
}

export interface JobRecord extends JobInput {
  id: string
  createdAt: string
  /** A job is inactive until its Edit page is saved for the first time. */
  active: boolean
  /** Last run result (null until the job has run). */
  lastRunAt: string | null
  lastStatus: 'success' | 'failed' | null
  lastError: string | null
  /** Alerting state machine: 'ok' until a run fails, back to 'ok' on recovery. */
  alertState: 'ok' | 'failed'
  /** First failure of the current failed streak (null when not failing). */
  incidentSince: string | null
  /** When muted, the job runs normally but emits no alerts. */
  muted: boolean
}

/** A muted job with its target name, for the topbar badge + settings list. */
export interface MutedJob {
  id: string
  name: string
  type: string
  targetName: string
}

/** An open incident (a job whose current streak is failing) for the dashboard. */
export interface Incident {
  jobId: string
  targetId: string
  name: string
  type: string
  targetName: string
  since: string | null
}

export interface RunResult {
  at: string
  status: 'success' | 'failed'
  error: string | null
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
  updateJob(id: string, input: JobInput): boolean
  setJobActive(id: string, active: boolean): void
  setJobMuted(id: string, muted: boolean): boolean
  setJobAlertState(id: string, state: 'ok' | 'failed'): void
  setIncidentSince(id: string, since: string | null): void
  listMutedJobs(): MutedJob[]
  listIncidents(): Incident[]
  deleteJob(id: string): boolean
  recordRun(id: string, run: RunResult): void
  getConfig(key: string): string | null
  setConfig(key: string, value: string): void
  close(): void
}

interface JobRow {
  id: string
  targetId: string
  name: string
  type: string
  sourcePath: string
  includes: string
  output: string
  subdirectory: string
  dateSuffix: number
  timeSuffix: number
  active: number
  alertState: 'ok' | 'failed'
  incidentSince: string | null
  muted: number
  createdAt: string
  lastRunAt: string | null
  lastStatus: 'success' | 'failed' | null
  lastError: string | null
}

function rowToJob(row: JobRow): JobRecord {
  return {
    ...row,
    includes: JSON.parse(row.includes) as string[],
    dateSuffix: !!row.dateSuffix,
    timeSuffix: !!row.timeSuffix,
    active: !!row.active,
    muted: !!row.muted,
  }
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
       source_path TEXT NOT NULL DEFAULT '',
       includes TEXT NOT NULL DEFAULT '[]',
       output TEXT NOT NULL DEFAULT 'single',
       subdirectory TEXT NOT NULL DEFAULT '',
       date_suffix INTEGER NOT NULL DEFAULT 0,
       time_suffix INTEGER NOT NULL DEFAULT 0,
       active INTEGER NOT NULL DEFAULT 0,
       alert_state TEXT NOT NULL DEFAULT 'ok',
       incident_since TEXT,
       muted INTEGER NOT NULL DEFAULT 0,
       created_at TEXT NOT NULL,
       last_run_at TEXT,
       last_status TEXT,
       last_error TEXT
     )`,
  )
  // Migrate job tables created before later columns existed.
  const jobColNames = (
    db.prepare('PRAGMA table_info(jobs)').all() as { name: string }[]
  ).map((c) => c.name)
  for (const col of ['last_run_at', 'last_status', 'last_error']) {
    if (!jobColNames.includes(col)) {
      db.exec(`ALTER TABLE jobs ADD COLUMN ${col} TEXT`)
    }
  }
  if (!jobColNames.includes('date_suffix')) {
    db.exec('ALTER TABLE jobs ADD COLUMN date_suffix INTEGER NOT NULL DEFAULT 0')
  }
  if (!jobColNames.includes('time_suffix')) {
    db.exec('ALTER TABLE jobs ADD COLUMN time_suffix INTEGER NOT NULL DEFAULT 0')
  }
  if (jobColNames.includes('excludes') && !jobColNames.includes('includes')) {
    db.exec('ALTER TABLE jobs RENAME COLUMN excludes TO includes')
  }
  if (!jobColNames.includes('active')) {
    db.exec('ALTER TABLE jobs ADD COLUMN active INTEGER NOT NULL DEFAULT 0')
  }
  if (!jobColNames.includes('alert_state')) {
    db.exec("ALTER TABLE jobs ADD COLUMN alert_state TEXT NOT NULL DEFAULT 'ok'")
  }
  if (!jobColNames.includes('muted')) {
    db.exec('ALTER TABLE jobs ADD COLUMN muted INTEGER NOT NULL DEFAULT 0')
  }
  if (!jobColNames.includes('incident_since')) {
    db.exec('ALTER TABLE jobs ADD COLUMN incident_since TEXT')
  }

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
                   includes, output, subdirectory, date_suffix AS dateSuffix,
                   time_suffix AS timeSuffix, active, alert_state AS alertState,
                   incident_since AS incidentSince, muted, created_at AS createdAt,
                   last_run_at AS lastRunAt,
                   last_status AS lastStatus, last_error AS lastError`
  const listJobsStmt = db.prepare(`SELECT ${jobCols} FROM jobs ORDER BY created_at`)
  const getJobStmt = db.prepare(`SELECT ${jobCols} FROM jobs WHERE id = ?`)
  const insertJobStmt = db.prepare(
    `INSERT INTO jobs
       (id, target_id, name, type, source_path, includes, output, subdirectory,
        date_suffix, time_suffix, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const updateJobStmt = db.prepare(
    `UPDATE jobs SET target_id = ?, name = ?, type = ?, source_path = ?,
       includes = ?, output = ?, subdirectory = ?, date_suffix = ?,
       time_suffix = ? WHERE id = ?`,
  )
  const setActiveStmt = db.prepare('UPDATE jobs SET active = ? WHERE id = ?')
  const setMutedStmt = db.prepare('UPDATE jobs SET muted = ? WHERE id = ?')
  const setAlertStateStmt = db.prepare('UPDATE jobs SET alert_state = ? WHERE id = ?')
  const setIncidentSinceStmt = db.prepare(
    'UPDATE jobs SET incident_since = ? WHERE id = ?',
  )
  const listMutedStmt = db.prepare(
    `SELECT j.id, j.name, j.type, t.name AS targetName
       FROM jobs j JOIN targets t ON t.id = j.target_id
      WHERE j.muted = 1 ORDER BY j.created_at`,
  )
  const listIncidentsStmt = db.prepare(
    `SELECT j.id AS jobId, j.target_id AS targetId, j.name, j.type,
            t.name AS targetName,
            COALESCE(j.incident_since, j.last_run_at) AS since
       FROM jobs j JOIN targets t ON t.id = j.target_id
      WHERE j.alert_state = 'failed'
      ORDER BY since DESC`,
  )
  const deleteJobStmt = db.prepare('DELETE FROM jobs WHERE id = ?')
  const recordRunStmt = db.prepare(
    'UPDATE jobs SET last_run_at = ?, last_status = ?, last_error = ? WHERE id = ?',
  )

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
        JSON.stringify(input.includes),
        input.output,
        input.subdirectory,
        input.dateSuffix ? 1 : 0,
        input.timeSuffix ? 1 : 0,
        createdAt,
      )
      return {
        ...input,
        id,
        createdAt,
        active: false,
        alertState: 'ok',
        incidentSince: null,
        muted: false,
        lastRunAt: null,
        lastStatus: null,
        lastError: null,
      }
    },

    updateJob(id: string, input: JobInput): boolean {
      return (
        updateJobStmt.run(
          input.targetId,
          input.name,
          input.type,
          input.sourcePath,
          JSON.stringify(input.includes),
          input.output,
          input.subdirectory,
          input.dateSuffix ? 1 : 0,
          input.timeSuffix ? 1 : 0,
          id,
        ).changes > 0
      )
    },

    setJobActive(id: string, active: boolean) {
      setActiveStmt.run(active ? 1 : 0, id)
    },

    setJobMuted: (id: string, muted: boolean) =>
      setMutedStmt.run(muted ? 1 : 0, id).changes > 0,

    setJobAlertState(id: string, state: 'ok' | 'failed') {
      setAlertStateStmt.run(state, id)
    },

    setIncidentSince(id: string, since: string | null) {
      setIncidentSinceStmt.run(since, id)
    },

    listMutedJobs: () => listMutedStmt.all() as unknown as MutedJob[],

    listIncidents: () => listIncidentsStmt.all() as unknown as Incident[],

    deleteJob: (id: string) => deleteJobStmt.run(id).changes > 0,

    recordRun(id: string, run: RunResult) {
      recordRunStmt.run(run.at, run.status, run.error, id)
    },

    getConfig: (key: string) => get(key),
    setConfig: (key: string, value: string) => set(key, value),

    close: () => db.close(),
  }
}
