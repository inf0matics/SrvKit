import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../../scripts/e2e-port.mjs')

function pickPort(env: Record<string, string> = {}): number {
  return Number(
    execFileSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    }).trim(),
  )
}

/** Hold a port so the picker sees it as taken. */
function hold(port: number): Promise<{ port: number; release: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(port, () => {
      resolve({
        port: (s.address() as { port: number }).port,
        release: () => new Promise((r) => s.close(() => r())),
      })
    })
  })
}

test('picks an OS-assigned port, never the contended 3100 default', () => {
  // The port is chosen at config load and bound seconds later, after the build,
  // so the pick can always go stale. Aiming at 3100 is what made that bite:
  // other tsp.tools services and parallel sessions all want that one port.
  // An OS-assigned port nobody else is targeting makes the window harmless.
  for (let i = 0; i < 3; i++) {
    const port = pickPort()
    assert.ok(port > 0, `expected a real port, got ${port}`)
    assert.notEqual(port, 3100, 'must not default to the contended 3100')
  }
})

test('E2E_PORT is honoured when it is free', async () => {
  // Borrow a port, release it, then ask for it by name.
  const probe = await hold(0)
  const wanted = probe.port
  await probe.release()

  assert.equal(pickPort({ E2E_PORT: String(wanted) }), wanted)
})

test('a busy E2E_PORT falls back instead of failing', async () => {
  const held = await hold(0)
  try {
    const port = pickPort({ E2E_PORT: String(held.port) })
    assert.ok(port > 0, `expected a fallback port, got ${port}`)
    assert.notEqual(port, held.port, 'must not hand back a port someone else holds')
  } finally {
    await held.release()
  }
})
