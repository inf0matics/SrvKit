/**
 * Prints the port the e2e server should use: an OS-assigned free port, or
 * $E2E_PORT when that is set and free.
 *
 * Why not a fixed default: Playwright needs the port at config-load time, but
 * the server only binds it after `npm run build` finishes seconds later, so the
 * pick is always a little stale and can be taken in between. That window cannot
 * be closed while the port has to be known up front — what it can do is stop
 * pointing at a port other people want. This used to prefer 3100, which every
 * tsp.tools service defaults to and parallel Claude Code sessions race over, so
 * the stale pick lost often enough to look like flaky tests (the server fails
 * to bind and Playwright reports a confusing ECONNREFUSED). An OS-assigned
 * ephemeral port is one nothing else is aiming for, which makes the same window
 * harmless.
 *
 * Set E2E_PORT when you do want a predictable port; a busy one still falls back
 * rather than failing, because a port someone else holds is their running work.
 *
 * Usage: node scripts/e2e-port.mjs   →   prints e.g. "59316"
 */
import { createServer } from 'net'

const PREFERRED = Number(process.env.E2E_PORT) || 0

// Bind without a host, exactly as the server does, so a listener on :: (which
// also claims 127.0.0.1 on a dual-stack socket) is detected as a conflict.
// Port 0 asks the OS for any free port, so it needs no fallback.
function tryListen(port) {
  return new Promise((resolve) => {
    const s = createServer()
    s.once('error', () => resolve(0))
    s.listen(port, () => {
      const chosen = s.address().port
      s.close(() => resolve(chosen))
    })
  })
}

const port = (PREFERRED && (await tryListen(PREFERRED))) || (await tryListen(0))
process.stdout.write(String(port))
