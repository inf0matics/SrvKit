// Aggregate backup health for the sidebar badge (spec 02.04).
export type BackupStatus = 'ok' | 'error'

/**
 * `error` if any job's last run failed, `ok` if all jobs last ran OK (or never
 * ran), and `null` when no jobs are configured (→ no badge).
 */
export function aggregateBackupStatus(jobs: { lastStatus: string | null }[]): BackupStatus | null {
  if (!jobs.length) return null
  return jobs.some((j) => j.lastStatus === 'failed') ? 'error' : 'ok'
}
