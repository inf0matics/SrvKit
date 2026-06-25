import { store } from '../../../utils/srvkit.ts'
import { jobState } from '../../../utils/watcher.ts'

// List jobs (optionally by ?targetId=), each tagged with its live state.
export default defineEventHandler((event) => {
  const targetId = getQuery(event).targetId
  return store()
    .listJobs()
    .filter((j) => typeof targetId !== 'string' || j.targetId === targetId)
    .map((j) => ({ ...j, ...jobState(j) }))
})
