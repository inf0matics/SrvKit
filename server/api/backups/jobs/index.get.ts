import { store } from '../../../utils/srvkit.ts'
import { isRunning } from '../../../utils/runner.ts'

// List jobs (optionally by ?targetId=), each tagged with its live running state.
export default defineEventHandler((event) => {
  const targetId = getQuery(event).targetId
  return store()
    .listJobs()
    .filter((j) => typeof targetId !== 'string' || j.targetId === targetId)
    .map((j) => ({ ...j, running: isRunning(j.id) }))
})
