import { sendPing, checkPeers, getPingIntervalSec } from '../utils/peers.ts'
import { WATCHDOG_TICK_MS } from '../../lib/peer-heartbeat.ts'

// Heartbeat loops: send our own ping on the configured interval, and watch
// registered peers for silence every minute. Both no-op when nothing is
// configured. The send loop reschedules itself from the current setting rather
// than using a fixed setInterval, so changing the interval in the UI takes
// effect without a restart.
export default defineNitroPlugin(() => {
  const scheduleSend = () => {
    setTimeout(async () => {
      await sendPing()
      scheduleSend()
    }, getPingIntervalSec() * 1000)
  }

  sendPing()
  checkPeers()
  scheduleSend()
  setInterval(() => checkPeers(), WATCHDOG_TICK_MS)
})
