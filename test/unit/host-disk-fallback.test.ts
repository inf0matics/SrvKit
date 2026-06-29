import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Setup where the host mount table is only reachable via /host/proc/1/mounts
// (no /host/etc/mtab mounted) — the common compose with just /proc + /:/host/root.
const base = mkdtempSync(join(tmpdir(), 'srvkit-diskfb-'))
const proc = join(base, 'proc')
const root = join(base, 'root')
mkdirSync(join(proc, '1'), { recursive: true })
mkdirSync(join(root, 'boot'), { recursive: true })
// Mirrors a real VPS /proc/1/mounts (host init): real partitions + Docker/runtime noise.
writeFileSync(
  join(proc, '1', 'mounts'),
  [
    '/dev/vda4 / ext4 rw,relatime 0 0',
    '/dev/vda3 /boot ext4 rw,relatime 0 0',
    'overlay /var/lib/docker/rootfs/overlayfs/abc overlay rw 0 0',
    'systemd-1 /proc/sys/fs/binfmt_misc autofs rw 0 0',
    'nsfs /run/docker/netns/x nsfs rw 0 0',
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

test('disk discovery reads the host table from /host/proc/1/mounts', () => {
  const ids = host.readMetrics().metrics.map((m) => m.id)
  // Real host partitions show…
  assert.ok(ids.includes('disk_root'), 'disk_root present')
  assert.ok(ids.includes('inode_root'))
  assert.ok(ids.includes('disk_boot'), 'disk_boot present')
  // …while overlay / autofs-under-/proc / nsfs-under-/run/docker / tmpfs are dropped.
  assert.ok(!ids.some((id) => id.includes('overlay') || id.includes('binfmt') || id === 'disk_run'))
})
