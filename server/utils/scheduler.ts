import { Cron } from 'croner'
import type { JobRecord } from '../../lib/store.ts'
import { store } from './srvkit.ts'
import { runBackup } from './runner.ts'

// Cron scheduling: PostgreSQL jobs (always) and SQLite jobs whose trigger is set
// to cron. Files jobs and filewatcher-SQLite jobs use the watcher instead.
const crons = new Map<string, Cron>()

/** Whether a job is cron-triggered rather than filewatcher-triggered. */
export function usesCron(job: JobRecord): boolean {
  return (
    job.type === 'postgres' ||
    job.type === 'mysql' ||
    (job.type === 'sqlite' && job.trigger === 'cron')
  )
}

/** (Re-)register the cron schedule for an active, cron-triggered job. */
export function registerCron(job: JobRecord) {
  unregisterCron(job.id)
  if (!job.active || !job.enabled || !usesCron(job) || !job.schedule.trim()) return
  try {
    crons.set(
      job.id,
      new Cron(job.schedule, () => {
        void runBackup(job.id)
      }),
    )
  } catch {
    // Invalid expression — leave unscheduled (Run Now still works).
  }
}

export function unregisterCron(id: string) {
  const c = crons.get(id)
  if (c) {
    c.stop()
    crons.delete(id)
  }
}

/** Re-register cron schedules for every active cron-triggered job (startup). */
export function registerAllCrons() {
  for (const job of store().listJobs()) {
    if (job.active && job.enabled && usesCron(job)) registerCron(job)
  }
}
