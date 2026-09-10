import { execFileSync } from 'node:child_process'
import { defineConfig } from '@playwright/test'

// E2E always runs its own production server and never reuses the dev server.
// It prefers 3100 but takes any free port when something already holds it:
// other tsp.tools services default to 3100 too, and parallel Claude Code
// sessions run e2e against this repo. A busy port is someone else's running
// work — step around it, never clear it out of the way.
// Playwright loads this config in the runner and again in each worker, so the
// port must be chosen once and inherited — picking again per load would point
// the tests at a different port than the server bound.
function resolvePort(): number {
  const alreadyChosen = Number(process.env.E2E_RESOLVED_PORT)
  if (alreadyChosen) return alreadyChosen
  const picked = Number(
    execFileSync(process.execPath, ['scripts/e2e-port.mjs'], { encoding: 'utf8' }).trim(),
  )
  if (picked !== 3100) {
    console.log(`[e2e] port 3100 is busy — using ${picked} instead`)
  }
  process.env.E2E_RESOLVED_PORT = String(picked)
  return picked
}

const PORT = resolvePort()
// The DB is keyed by port so two e2e runs on different ports don't wipe each
// other's state (the server boots by deleting it, see the command below).
const DB = `./.data/e2e-${PORT}.db`
// Destinations for local-directory targets. Keyed by port like the DB, wiped
// per run, and pre-seeded with a folder so the directory browser has something
// to navigate into.
const TARGETS = `./.data/e2e-targets-${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  // Auth flow mutates shared server state (the SQLite DB), so run serially.
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  webServer: {
    // Wipe this run's DB first so the server always boots in first-start / setup
    // mode, and sweep DBs from fallback ports left by runs that are long over —
    // 6h keeps well clear of any run that could still be going.
    command:
      `npm run build` +
      // Subshell: `|| true` must swallow only find's failure. Left unbracketed it
      // would also rescue a failed build and boot a stale server against the tests.
      ` && (find ./.data -name 'e2e-*.db*' -mmin +360 -delete 2>/dev/null || true)` +
      // Same sweep for the local-target directories beside them: a killed run
      // leaks one with real seeded archives inside and nothing else removes it.
      ` && (find ./.data -maxdepth 1 -type d -name 'e2e-targets-*' -mmin +360` +
      ` -exec rm -rf {} + 2>/dev/null || true)` +
      ` && rm -f ${DB} ${DB}-wal ${DB}-shm` +
      ` && rm -rf ${TARGETS} && mkdir -p ${TARGETS}/disk2/nightly` +
      ` && node .output/server/index.mjs`,
    port: PORT,
    env: {
      PORT: String(PORT),
      DATABASE_PATH: DB,
      COOKIE_SECURE: 'false', // plain http in e2e
      ENCRYPTION_KEY: 'e2e-encryption-key',
      BACKUP_SOURCES_DIR: './tests/fixtures/sources',
      BACKUP_TARGETS_DIR: TARGETS,
      // Backup targets in e2e point at 127.0.0.1 — allow private hosts (see M3).
      ALLOW_PRIVATE_WEBDAV: '1',
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
