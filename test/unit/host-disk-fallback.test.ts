import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Setup where the host mount table is only reachable via /host/proc/mounts
// (no /host/etc/mtab mounted) — the common compose with just /proc + /:/host/root.
const base = mkdtempSync(join(tmpdir(), 'srvkit-diskfb-'))
const proc = join(base, 'proc')
const root = join(base, 'root')
mkdirSync(proc, { recursive: true })
mkdirSync(root, { recursive: true })
writeFileSync(
  join(proc, 'mounts'),
  [
    '/dev/sda1 / ext4 rw 0 0',
    'overlay /var/lib/docker/overlay2/x overlay rw 0 0',
    'tmpfs /run tmpfs rw 0 0',
  ].join('\n') + '\n',
)

process.env.DATABASE_PATH = join(base, 'db.sqlite')
process.env.ENCRYPTION_KEY = 'diskfb-key'
process.env.BACKUP_SOURCES_DIR = join(base, 'sources')
process.env.HOST_PROC = proc
process.env.HOST_SYS = join(base, 'no-sys')
process.env.HOST_ROOT = root
process.env.HOST_MTAB = join(base, 'no-mtab') // absent → fall back to proc/mounts

const host = await import('../../server/utils/host.ts')
const { store } = await import('../../server/utils/srvkit.ts')

after(() => {
  store().close()
  rmSync(base, { recursive: true, force: true })
})

test('disk discovery falls back to /host/proc/mounts when mtab is absent', () => {
  const ids = host.readMetrics().metrics.map((m) => m.id)
  assert.ok(ids.includes('disk_root'), 'disk_root present via the proc/mounts fallback')
  assert.ok(ids.includes('inode_root'))
  // overlay + tmpfs noise stays filtered out
  assert.ok(!ids.some((id) => id.includes('overlay') || id === 'disk_run'))
})
