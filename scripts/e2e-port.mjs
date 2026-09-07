/**
 * Prints the port the e2e server should use: the preferred one (3100, or
 * $E2E_PORT) when it is free, otherwise a free port picked by the OS.
 *
 * Several tsp.tools services default to 3100, and parallel Claude Code sessions
 * run e2e against the same repo. A busy 3100 is therefore someone else's running
 * work — we step around it rather than failing on EADDRINUSE, which is what
 * tempts a session into killing a process it does not own.
 *
 * Usage: node scripts/e2e-port.mjs   →   prints e.g. "3100"
 */
import { createServer } from 'net'

const PREFERRED = Number(process.env.E2E_PORT) || 3100

// Bind without a host, exactly as the server does, so a listener on :: (which
// also claims 127.0.0.1 on a dual-stack socket) is detected as a conflict.
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

// Port 0 asks the OS for any free port.
const port = (await tryListen(PREFERRED)) || (await tryListen(0))
process.stdout.write(String(port))
