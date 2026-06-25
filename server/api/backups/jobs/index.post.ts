import { store } from '../../../utils/srvkit.ts'
import { parseJobInput } from '../../../utils/backups.ts'

// Create a Files backup job. The filewatcher that acts on it is spec 06.
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  return store().createJob(parseJobInput(body))
})
