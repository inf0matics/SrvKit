import { store } from '../../utils/srvkit.ts'

// Currently muted jobs (with target name) — drives the topbar badge + the
// Settings → Alerts muted list.
export default defineEventHandler(() => {
  const jobs = store().listMutedJobs()
  return { count: jobs.length, jobs }
})
