import { DatabaseSync, backup } from 'node:sqlite'

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
