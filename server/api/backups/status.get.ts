import { store } from '../../utils/srvkit.ts'
import { aggregateBackupStatus } from '../../../lib/backup-status.ts'

// Aggregate backup health for the sidebar badge: error if any job's last run
// failed, ok if all OK/never-run, null when no jobs exist.
export default defineEventHandler(() => {
  return { status: aggregateBackupStatus(store().listJobs()) }
})
