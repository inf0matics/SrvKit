import { getSources } from '../../../utils/backups.ts'

// Mounted source directories available for Files backup jobs.
export default defineEventHandler(() => ({ sources: getSources() }))
