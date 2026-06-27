import { DatabaseSync, backup } from 'node:sqlite'
import { openSync, readSync, closeSync, existsSync } from 'node:fs'

// "SQLite format 3\0" — the 16-byte header magic at the start of every db file.
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1')

/**
 * True when `path` is a WAL-mode database — detected by a `-wal`/`-shm` sidecar
 * next to it. In WAL mode writes land in the sidecar and the main `.db` file
 * only changes on checkpoint, so a filewatcher on it is unreliable.
 */
export function isWalDatabase(path: string): boolean {
  return existsSync(path + '-wal') || existsSync(path + '-shm')
}

/** True if `path` is a readable file beginning with the SQLite header magic. */
export function isSqliteFile(path: string): boolean {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const buf = Buffer.alloc(16)
    const n = readSync(fd, buf, 0, 16, 0)
    return n === 16 && buf.equals(SQLITE_MAGIC)
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * Make a consistent copy of a (possibly live) SQLite database using the online
 * backup API. The source is opened read-only, so no application stop is needed
 * and the `-wal`/`-shm` sidecars are handled by SQLite itself.
 */
export async function backupSqliteFile(
  srcPath: string,
  destPath: string,
): Promise<void> {
  const src = new DatabaseSync(srcPath, { readOnly: true })
  try {
    await backup(src, destPath)
  } finally {
    src.close()
  }
}
