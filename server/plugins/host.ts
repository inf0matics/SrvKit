import { primeHost } from '../utils/host.ts'

// Take initial /proc samples so the first metrics fetch can already report rate
// metrics (CPU %, disk I/O, network throughput are deltas between two samples).
export default defineNitroPlugin(() => {
  primeHost()
})
