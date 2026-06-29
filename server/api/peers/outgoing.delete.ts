import { clearOutgoing } from '../../utils/peers.ts'

// Stop sending heartbeats — clears the single outgoing target.
export default defineEventHandler(() => {
  clearOutgoing()
  return { ok: true }
})
