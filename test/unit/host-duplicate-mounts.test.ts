import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A host whose mount table lists the same mountpoint twice (a stray bind /
// symlink mount landing on an already-mounted path — the kernel keeps both
// entries) and two distinct mountpoints that slugify to the same id.
// Metric ids must stay unique: they key the per-metric config AND the list
// rendering, so a duplicate id makes the toggle edit the wrong row.
const base = mkdtempSync(join(tmpdir(), 'srvkit-dupmnt-'))
const proc = join(base, 'proc')
const root = join(base, 'root')
mkdirSync(join(proc, '1'), { recursive: true })
mkdirSync(join(root, 'mnt/data'), { recursive: true })
mkdirSync(join(root, 'mnt/data-1'), { recursive: true })
mkdirSync(join(root, 'mnt/data_1'), { recursive: true })
writeFileSync(
  join(proc, '1', 'mounts'),
  [
    '/dev/vda4 / ext4 rw,relatime 0 0',
    '/dev/sdb1 / ext4 rw,relatime 0 0', // over-mount on /
    '/dev/sdc1 /mnt/data ext4 rw 0 0',
    '/dev/sdc1 /mnt/data ext4 rw 0 0', // listed twice verbatim
    '/dev/sdd1 /mnt/data-1 ext4 rw 0 0', // slugifies to mnt_data_1 …
    '/dev/sdd2 /mnt/data_1 ext4 rw 0 0', // … same as this one
  ].join('\n') + '\n',
)

process.env.DATABASE_PATH = join(base, 'db.sqlite')
process.env.ENCRYPTION_KEY = 'dupmnt-key'
process.env.BACKUP_SOURCES_DIR = join(base, 'sources')
process.env.HOST_PROC = proc
process.env.HOST_SYS = join(base, 'no-sys')
process.env.HOST_ROOT = root
process.env.HOST_MTAB = join(base, 'no-mtab')

const host = await import('../../server/utils/host.ts')
const { store } = await import('../../server/utils/srvkit.ts')

after(() => {
  store().close()
  rmSync(base, { recursive: true, force: true })
})

test('metric ids stay unique when the mount table repeats a mountpoint', () => {
  const ids = host.readMetrics().metrics.map((m) => m.id)
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
  assert.deepEqual(dupes, [], `duplicate metric ids: ${[...new Set(dupes)].join(', ')}`)
})

test('every real partition still gets its own disk metric', () => {
  const ids = host.readMetrics().metrics.map((m) => m.id)
  for (const id of ['disk_root', 'disk_mnt_data', 'inode_root', 'inode_mnt_data']) {
    assert.ok(ids.includes(id), `${id} present`)
  }
  // The two colliding mountpoints keep one metric each, disambiguated.
  assert.equal(ids.filter((id) => id.startsWith('disk_mnt_data_1')).length, 2)
})

test('disabling a metric does not disable a second one', () => {
  host.setMetricConfig('disk_root', { enabled: false })
  const off = host.readMetrics().metrics.filter((m) => !m.enabled)
  assert.deepEqual(
    off.map((m) => m.id),
    ['disk_root'],
  )
})
