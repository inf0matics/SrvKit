import { store } from '../utils/srvkit.ts'

// Dashboard summary: job count, the most recent successful backup, and the
// currently-open incidents (failing jobs). Computed live from job state.
export default defineEventHandler(() => {
  const jobs = store().listJobs()

  let lastBackup: { name: string; at: string } | null = null
  for (const j of jobs) {
    if (j.lastStatus === 'success' && j.lastRunAt) {
      if (!lastBackup || j.lastRunAt > lastBackup.at) {
        lastBackup = { name: j.name, at: j.lastRunAt }
      }
    }
  }

  return {
    jobCount: jobs.length,
    lastBackup,
    incidents: store().listIncidents(),
  }
})
