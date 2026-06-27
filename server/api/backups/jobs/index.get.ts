import { store } from '../../../utils/srvkit.ts'
import { jobState } from '../../../utils/watcher.ts'
import { publicJob } from '../../../utils/backups.ts'
import { nextRun } from '../../../../lib/cron.ts'

// List jobs (optionally by ?targetId=), each tagged with its live state and
// (for PostgreSQL) the next scheduled run. The encrypted DB password is stripped.
export default defineEventHandler((event) => {
  const targetId = getQuery(event).targetId
  return store()
    .listJobs()
    .filter((j) => typeof targetId !== 'string' || j.targetId === targetId)
    .map((j) => ({ ...publicJob(j), ...jobState(j), nextRun: nextRun(j.schedule) }))
})
