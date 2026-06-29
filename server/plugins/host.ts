import { readMetrics, POLL_INTERVAL_SECONDS } from '../utils/host.ts'

// Poll host metrics on a fixed interval. Each tick advances the rate baselines
// (CPU %, disk I/O, throughput) and the consecutive over-threshold counters that
// gate WARN/CRIT. UI reads (readMetrics(false)) don't advance anything.
export default defineNitroPlugin(() => {
  readMetrics(true) // prime samples + first poll
  // HOST_POLL_LOOP=off freezes counters at the first poll (used by e2e).
  if (process.env.HOST_POLL_LOOP !== 'off') {
    setInterval(() => readMetrics(true), POLL_INTERVAL_SECONDS * 1000)
  }
})
