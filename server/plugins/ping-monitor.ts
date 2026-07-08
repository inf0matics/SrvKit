import { pollPings, PING_POLL_INTERVAL_SECONDS } from '../utils/ping-monitor.ts'

// Poll configured pings every 15s; each ping is only actually checked once its
// own frequency has elapsed. A no-op when no pings are configured.
export default defineNitroPlugin(() => {
  pollPings()
  setInterval(() => pollPings(), PING_POLL_INTERVAL_SECONDS * 1000)
})
