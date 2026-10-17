import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JOB_REFUSALS, type JobRefusal } from '../../lib/jobRefusals.ts'

const base = mkdtempSync(join(tmpdir(), 'srvkit-refuse-'))
process.env.DATABASE_PATH = join(base, 'db.sqlite')
process.env.ENCRYPTION_KEY = 'refuse-key'
process.env.BACKUP_SOURCES_DIR = join(base, 'sources')

const { store } = await import('../../server/utils/srvkit.ts')
const { parseJobInput } = await import('../../server/utils/backups.ts')

let targetId = ''

before(() => {
  mkdirSync(join(base, 'sources', 'root'), { recursive: true })
  writeFileSync(join(base, 'sources', 'root', 'file.txt'), 'hello')
  targetId = store().createTarget({
    name: 'T',
    type: 'local',
    host: '',
    username: '',
    password: '',
    rootDir: 'nas',
  }).id
})

const body = (over: Record<string, unknown> = {}) => ({
  targetId,
  name: 'db',
  type: 'files',
  sourcePath: 'root',
  includes: ['file.txt'],
  subdirectory: 'sub',
  ...over,
})

/** The error shape the client reads: wording in `statusMessage`, field in `data`. */
function refusedBy(over: Record<string, unknown>): { statusMessage: string; field: unknown } {
  try {
    parseJobInput(body(over))
  } catch (e) {
    const err = e as { statusMessage?: string; data?: { field?: unknown } }
    return { statusMessage: err.statusMessage ?? '', field: err.data?.field }
  }
  throw new Error('parseJobInput accepted a job it should have refused')
}

/**
 * The form marks a field by matching `data.field` against its own inputs, and
 * shows `statusMessage` as the reason. Both halves have to arrive, and as the
 * shared entry — the form pre-checks the same conditions against that entry, so
 * an API that worded one of them differently would mark nothing.
 */
const cases: [string, Record<string, unknown>, JobRefusal][] = [
  ['postgres without a container', { type: 'postgres' }, JOB_REFUSALS.container],
  [
    'postgres without a database',
    { type: 'postgres', container: 'db' },
    JOB_REFUSALS.database,
  ],
  [
    'postgres without a user',
    { type: 'postgres', container: 'db', database: 'app' },
    JOB_REFUSALS.dbUser,
  ],
  [
    'postgres without a schedule',
    { type: 'postgres', container: 'db', database: 'app', dbUser: 'postgres' },
    JOB_REFUSALS.schedule,
  ],
  ['sqlite without a source file', { type: 'sqlite', sourcePath: '' }, JOB_REFUSALS.sourceFile],
  ['files from an unknown directory', { sourcePath: 'nope' }, JOB_REFUSALS.sourceDir],
  ['files with nothing selected', { includes: [] }, JOB_REFUSALS.includes],
]

for (const [what, over, refusal] of cases) {
  test(`${what} is refused as ${refusal.field}`, () => {
    const refused = refusedBy(over)
    assert.equal(refused.statusMessage, refusal.message)
    assert.equal(refused.field, refusal.field)
  })
}

/** Refusals the form cannot produce still name their field, for the report. */
test('the server-only refusals name a field too', () => {
  assert.equal(refusedBy({ subdirectory: '../escape' }).field, 'subdirectory')
  assert.equal(refusedBy({ keepVersions: 2.5 }).field, 'keepVersions')
})
