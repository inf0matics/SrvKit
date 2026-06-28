import { primeCpu } from '../utils/host.ts'

// Take an initial /proc/stat sample so the first metrics fetch can already
// report CPU utilization (it's a delta between two samples).
export default defineNitroPlugin(() => {
  primeCpu()
})
