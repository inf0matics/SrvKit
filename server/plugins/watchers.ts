import { registerAllJobs } from '../utils/watcher.ts'
import { registerAllCrons } from '../utils/scheduler.ts'

// On startup, re-arm every active job's trigger: filewatchers for Files/SQLite
// jobs and cron schedules for PostgreSQL jobs. No backup runs until a watched
// file changes or a schedule fires.
export default defineNitroPlugin(() => {
  registerAllJobs()
  registerAllCrons()
})
