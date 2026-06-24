import { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
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
export interface Store {
  isInitialized(): boolean
  getPasswordHash(): string | null
  getSessionSecret(): string
  setPassword(hash: string): void
  close(): void
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
    close: () => db.close(),
  }
}
