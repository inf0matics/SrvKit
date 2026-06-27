import { store } from '../../../utils/srvkit.ts'
import { parseNewJob, publicJob } from '../../../utils/backups.ts'

// Create a job from the lightweight modal: just name + type. The job is created
// inactive (no trigger) and configured/activated on its edit page.
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  return publicJob(store().createJob(parseNewJob(body)))
})
