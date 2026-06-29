import { mounts, readMetrics, POLL_INTERVAL_SECONDS } from '../../utils/host.ts'

// Host metrics with OK/WARN/CRIT state, the required mounts (+ which are
// missing), and the worst-of aggregate status for the sidebar badge.
export default defineEventHandler(() => {
  const mts = mounts()
  const available = mts.filter((m) => !m.optional).every((m) => m.present)
  const { metrics, status } = readMetrics()
  return { mounts: mts, available, metrics, status, pollIntervalSeconds: POLL_INTERVAL_SECONDS }
})
