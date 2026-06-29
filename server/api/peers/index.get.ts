import { listPeerViews, pendingView, outgoingView } from '../../utils/peers.ts'

// State for /app/peers: registered peers + aggregate, the current pending
// pairing key (if a probe just arrived), and the outgoing heartbeat target.
export default defineEventHandler(() => {
  const { peers, status } = listPeerViews()
  return { peers, status, pending: pendingView(), outgoing: outgoingView() }
})
