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
      ENCRYPTION_KEY: 'e2e-encryption-key',
      BACKUP_SOURCES_DIR: './tests/fixtures/sources',
      // No Docker in CI — point at a missing socket so PostgreSQL jobs report
      // the "not mounted" state deterministically.
      DOCKER_SOCKET: '/tmp/srvkit-e2e-no-docker.sock',
      // Host monitoring reads from a committed fixture /proc + /sys (required,
      // present). The optional host root is left UNmounted so the Disk
      // mount-warning renders and the aggregate stays deterministic (no
      // machine-dependent statfs disk %). Disk usage via statfs is unit-tested.
      HOST_PROC: './tests/fixtures/host/proc',
      HOST_SYS: './tests/fixtures/host/sys',
      HOST_ROOT: '/tmp/srvkit-e2e-no-host-root',
      // Freeze the consecutive-poll counters at the first poll (deterministic).
      HOST_POLL_LOOP: 'off',
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
