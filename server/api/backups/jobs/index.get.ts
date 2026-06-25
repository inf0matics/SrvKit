import { store } from '../../../utils/srvkit.ts'

// List jobs, optionally filtered by target via ?targetId=.
export default defineEventHandler((event) => {
  const targetId = getQuery(event).targetId
  const jobs = store().listJobs()
  return typeof targetId === 'string'
    ? jobs.filter((j) => j.targetId === targetId)
    : jobs
})
