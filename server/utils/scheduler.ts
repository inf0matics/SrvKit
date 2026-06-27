import { Cron } from 'croner'
import type { JobRecord } from '../../lib/store.ts'
import { store } from './srvkit.ts'
import { runBackup } from './runner.ts'

// Cron scheduling for PostgreSQL jobs (Files/SQLite use the filewatcher instead).
const crons = new Map<string, Cron>()

/** (Re-)register the cron schedule for an active, scheduled PostgreSQL job. */
export function registerCron(job: JobRecord) {
  unregisterCron(job.id)
  if (!job.active || job.type !== 'postgres' || !job.schedule.trim()) return
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

/** Re-register cron schedules for every active PostgreSQL job (startup). */
export function registerAllCrons() {
  for (const job of store().listJobs()) {
    if (job.active && job.type === 'postgres') registerCron(job)
  }
}
