import { createPendingKey } from '../../utils/peers.ts'
import { getServerName } from '../../utils/alerts.ts'

// Reachability check from a connecting peer. Side effect: generate a one-time
// pairing key that this instance's owner copies into the other SrvKit.
export default defineEventHandler(() => {
  createPendingKey()
  return { ok: true, name: getServerName() || 'SrvKit' }
})
