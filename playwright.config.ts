import { defineConfig } from '@playwright/test'

// E2E always runs its own production server on port 3100 and never reuses the
// dev server — keeps parallel Claude Code sessions from colliding.
const PORT = 3100
const DB = './.data/e2e.db'

export default defineConfig({
  testDir: './tests/e2e',
  // Auth flow mutates shared server state (the SQLite DB), so run serially.
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  webServer: {
    // Wipe the DB first so the server always boots in first-start / setup mode.
    command: `npm run build && rm -f ${DB} ${DB}-wal ${DB}-shm && node .output/server/index.mjs`,
    port: PORT,
    env: {
      PORT: String(PORT),
      DATABASE_PATH: DB,
      COOKIE_SECURE: 'false', // plain http in e2e
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
