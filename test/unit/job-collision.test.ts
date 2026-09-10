import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = mkdtempSync(join(tmpdir(), 'srvkit-collide-'))
process.env.DATABASE_PATH = join(base, 'db.sqlite')
process.env.ENCRYPTION_KEY = 'collide-key'
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
  dateSuffix: true,
  keepVersions: 2,
  ...over,
})

/**
 * Two jobs writing the same archive names into one directory cannot tell their
 * histories apart, so retention would delete the other's backups. Refuse the
 * collision at the point it is created.
 */
test('a job may be saved when nothing else writes that name and folder', () => {
  const input = parseJobInput(body())
  assert.equal(input.name, 'db')
})

test('a second job with the same name, target and folder is rejected', () => {
  store().createJob({
    ...parseJobInput(body()),
    output: 'single',
    timeSuffix: false,
  })
  assert.throws(() => parseJobInput(body()), /already writes/i)
})

test('the same name is fine in a different folder', () => {
  const input = parseJobInput(body({ subdirectory: 'other' }))
  assert.equal(input.subdirectory, 'other')
})

test('a job editing itself does not collide with itself', () => {
  const existing = store()
    .listJobs()
    .find((j) => j.name === 'db' && j.subdirectory === 'sub')!
  const input = parseJobInput(body({ name: 'db' }), existing.id)
  assert.equal(input.name, 'db')
})

/* ---- a sub-directory must stay under the target root ---- */

test('a job subdirectory that climbs out of the target root is rejected', () => {
  assert.throws(
    () => parseJobInput(body({ name: 'esc1', subdirectory: '../../elsewhere' })),
    /sub-directory/i,
  )
  assert.throws(
    () => parseJobInput(body({ name: 'esc2', subdirectory: 'db/../../etc' })),
    /sub-directory/i,
  )
})

test('a leading slash is just tidied away, not treated as an escape', () => {
  // normalizeRoot strips it, so this is the relative folder "etc".
  const input = parseJobInput(body({ name: 'lead', subdirectory: '/etc' }))
  assert.equal(input.subdirectory, 'etc')
})

test('an ordinary nested subdirectory is still fine', () => {
  const input = parseJobInput(body({ name: 'nested', subdirectory: 'db/nightly' }))
  assert.equal(input.subdirectory, 'db/nightly')
})
