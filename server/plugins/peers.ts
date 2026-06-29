import { sendPing, checkPeers } from '../utils/peers.ts'

// Heartbeat loops: send our own ping every 5 min, and watch registered peers
// for silence every minute. Both no-op when nothing is configured.
export default defineNitroPlugin(() => {
  sendPing()
  checkPeers()
  setInterval(() => sendPing(), 5 * 60 * 1000)
  setInterval(() => checkPeers(), 60 * 1000)
})
