import {
  listPeerViews,
  pendingView,
  outgoingView,
  ipCheckEnabled,
  timingView,
} from '../../utils/peers.ts'

// State for /app/peers: registered peers + aggregate, the current pending
// pairing key (if a probe just arrived), the outgoing heartbeat target, the
// heartbeat timing and the IP-allowlist setting.
export default defineEventHandler(() => {
  const { peers, status } = listPeerViews()
  return {
    peers,
    status,
    pending: pendingView(),
    outgoing: outgoingView(),
    timing: timingView(),
    ipAllowlist: ipCheckEnabled(),
  }
})
