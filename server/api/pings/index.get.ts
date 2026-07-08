import { readPings } from '../../utils/ping-monitor.ts'

// Ping list with per-ping status + the worst-of aggregate for the badge.
export default defineEventHandler(() => readPings())
