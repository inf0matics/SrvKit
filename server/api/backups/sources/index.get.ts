import { getSources, getDbSources } from '../../../utils/backups.ts'

// Mounted sources available for backup jobs: directories (Files) and .db files
// (SQLite).
export default defineEventHandler(() => ({
  sources: getSources(),
  dbFiles: getDbSources(),
}))
