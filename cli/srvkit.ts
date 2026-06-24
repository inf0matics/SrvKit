import { pathToFileURL } from 'node:url'
import { openStore } from '../lib/store.ts'
import { hashPassword, isValidPassword } from '../lib/password.ts'

function databasePath(): string {
  return process.env.DATABASE_PATH || './.data/srvkit.db'
}

/**
 * Overwrite the stored password hash. Rotating the session secret (done inside
 * the store) invalidates every active session — there is no HTTP equivalent of
 * this, shell access is the only gate.
 */
export function changePassword(password: string): void {
  if (!isValidPassword(password)) {
    throw new Error('password must not be empty')
  }
  const store = openStore(databasePath())
  try {
    store.setPassword(hashPassword(password))
  } finally {
    store.close()
  }
}

export function run(argv: string[]): number {
  const [command, password] = argv
  if (command !== 'change-password') {
    console.error('Usage: srvkit change-password "<password>"')
    return 1
  }
  try {
    changePassword(password ?? '')
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`)
    return 1
  }
  console.log('Password updated. All sessions invalidated.')
  return 0
}

// Execute only when run as a script (`node srvkit.mjs ...`), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(run(process.argv.slice(2)))
}
