import { registerAllJobs } from '../utils/watcher.ts'

// Re-register filewatchers for all active jobs on startup. No backup runs unless
// a file change is detected afterwards.
export default defineNitroPlugin(() => {
  registerAllJobs()
})
