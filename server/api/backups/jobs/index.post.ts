import { store } from '../../../utils/srvkit.ts'
import { parseJobInput } from '../../../utils/backups.ts'
import { registerJob } from '../../../utils/watcher.ts'

// Create a Files backup job and start watching its selected files.
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const job = store().createJob(parseJobInput(body))
  registerJob(job)
  return job
})
