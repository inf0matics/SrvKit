import { resolveSourcePath } from '../../utils/backups.ts'
import { isWalDatabase } from '../../../lib/sqlite-backup.ts'

// Whether the selected SQLite file is in WAL mode (has a -wal/-shm sidecar).
// Drives the edit page's automatic Cron-only trigger lock.
export default defineEventHandler((event) => {
  const path = String(getQuery(event).path ?? '')
  const abs = resolveSourcePath(path)
  if (!abs) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid path' })
  }
  return { wal: isWalDatabase(abs) }
})
