import { listPeerViews, pendingView, outgoingView, ipCheckEnabled } from '../../utils/peers.ts'

// State for /app/peers: registered peers + aggregate, the current pending
// pairing key (if a probe just arrived), the outgoing heartbeat target, and
// the IP-allowlist setting.
export default defineEventHandler(() => {
  const { peers, status } = listPeerViews()
  return {
    peers,
    status,
    pending: pendingView(),
    outgoing: outgoingView(),
    ipAllowlist: ipCheckEnabled(),
  }
})
