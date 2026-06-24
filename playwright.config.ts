import { defineConfig } from '@playwright/test'

// E2E always runs its own production server on port 3100 and never reuses the
// dev server — keeps parallel Claude Code sessions from colliding.
const PORT = 3100

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  webServer: {
    command: 'npm run build && node .output/server/index.mjs',
    port: PORT,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
