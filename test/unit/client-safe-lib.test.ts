import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * `lib/` is shared between the server, the CLI and — for a few pure modules —
 * the Nuxt client, so the mode<->column mapping cannot drift between the API
 * and the form that produces it. That only holds while those modules stay
 * framework-free: a `node:` import would compile fine here and break the client
 * bundle at build time, far from the edit that caused it.
 *
 * Add a module to this list only when the client actually imports it.
 */
const CLIENT_IMPORTED = ['lib/retention.ts']

for (const rel of CLIENT_IMPORTED) {
  test(`${rel} stays free of Node built-ins so the client can import it`, () => {
    const src = readFileSync(join(repo, rel), 'utf8')
    const offenders = [...src.matchAll(/from\s+['"](node:[^'"]+)['"]/g)].map((m) => m[1])
    assert.deepEqual(
      offenders,
      [],
      `${rel} is imported by the Nuxt client; move Node-only code elsewhere`,
    )
  })
}

test('the client imports only modules on that list', () => {
  const clientFiles = [
    'app/pages/app/backups/[id]/jobs/[jobId]/edit.vue',
    'app/components/TargetJobs.vue',
    'app/utils/targetPath.ts',
    'app/composables/useTargets.ts',
    'app/pages/app/backups/index.vue',
    'app/pages/app/backups/[id]/index.vue',
  ]
  for (const file of clientFiles) {
    const src = readFileSync(join(repo, file), 'utf8')
    for (const m of src.matchAll(/from\s+['"]~~\/(lib\/[^'"]+)['"]/g)) {
      const imported = m[1]!.endsWith('.ts') ? m[1]! : `${m[1]}.ts`
      assert.ok(
        CLIENT_IMPORTED.includes(imported),
        `${file} imports ${imported}, which is not vetted as client-safe`,
      )
    }
  }
})
