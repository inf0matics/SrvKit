import { mounts, readMetrics } from '../../utils/host.ts'

// Host metrics with OK/WARN/CRIT state, the required mounts (+ which are
// missing), and the worst-of aggregate status for the sidebar badge.
export default defineEventHandler(() => {
  const mts = mounts()
  const available = mts.every((m) => m.present)
  const { metrics, status } = readMetrics()
  return { mounts: mts, available, metrics, status }
})
