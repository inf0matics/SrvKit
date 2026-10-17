import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { jobProblems, type JobFormFields } from '../../app/utils/jobProblems.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')

const base: JobFormFields = {
  name: 'Nightly',
  type: 'files',
  sourcePath: '',
  trigger: 'filewatcher',
  schedule: '',
  container: '',
  database: '',
  dbUser: '',
  dbPassword: '',
}
const fields = (p: JobProblemList) => p.map((x) => x.field)
type JobProblemList = ReturnType<typeof jobProblems>

test('a complete files job has no problems', () => {
  const problems = jobProblems(
    { ...base, sourcePath: '/backups/src' },
    ['notes.txt'],
    false,
  )
  assert.deepEqual(problems, [])
})

test('files: names the source directory and the empty selection', () => {
  assert.deepEqual(fields(jobProblems(base, [], false)), ['sourcePath', 'includes'])
  assert.deepEqual(
    fields(jobProblems({ ...base, sourcePath: '/backups/src' }, [], false)),
    ['includes'],
  )
})

test('a missing name is reported first, before the type-specific fields', () => {
  assert.deepEqual(fields(jobProblems({ ...base, name: '  ' }, [], false)), [
    'name',
    'sourcePath',
    'includes',
  ])
})

test('sqlite: the source file, and the schedule only when cron-triggered', () => {
  assert.deepEqual(fields(jobProblems({ ...base, type: 'sqlite' }, [], false)), [
    'sourcePath',
  ])
  // Filewatcher needs no schedule; cron does.
  const cron = { ...base, type: 'sqlite', sourcePath: 'app.db', trigger: 'cron' }
  assert.deepEqual(fields(jobProblems(cron, [], false)), ['schedule'])
  assert.deepEqual(fields(jobProblems({ ...cron, schedule: 'not a cron' }, [], false)), [
    'schedule',
  ])
  assert.deepEqual(jobProblems({ ...cron, schedule: '0 3 * * *' }, [], false), [])
})

test('postgres: every missing field, in the order the form shows them', () => {
  const pg = { ...base, type: 'postgres' }
  assert.deepEqual(fields(jobProblems(pg, [], false)), [
    'container',
    'database',
    'dbUser',
    'dbPassword',
    'schedule',
  ])
  // A stored password is kept when the field is left blank (PUT resolves it).
  assert.deepEqual(fields(jobProblems(pg, [], true)), [
    'container',
    'database',
    'dbUser',
    'schedule',
  ])
  const full = {
    ...pg,
    container: 'db',
    database: 'app',
    dbUser: 'postgres',
    dbPassword: 's3cret',
    schedule: '0 3 * * *',
  }
  assert.deepEqual(jobProblems(full, [], false), [])
  // MySQL is the same container-dump flow.
  assert.deepEqual(jobProblems({ ...full, type: 'mysql' }, [], false), [])
  // Includes are irrelevant to a container dump.
  assert.deepEqual(jobProblems(full, [], false), [])
})

/**
 * The form pre-checks what the API also checks, so the two must not drift into
 * saying different things about the same missing field. The name is the one
 * exception: the API's `name and targetId are required` is an API-shaped
 * message that no form field should ever show.
 */
test('every message the form shows is a message the API itself throws', () => {
  const server = [
    readFileSync(join(repo, 'server/utils/backups.ts'), 'utf8'),
    readFileSync(join(repo, 'server/api/backups/jobs/[id]/index.put.ts'), 'utf8'),
  ].join('\n')

  const everyField = jobProblems(
    { ...base, name: '', type: 'postgres' },
    [],
    false,
  ).concat(jobProblems({ ...base, type: 'sqlite', trigger: 'cron' }, [], false))
    .concat(jobProblems(base, [], false))

  for (const { field, message } of everyField) {
    if (field === 'name') continue
    assert.ok(
      server.includes(`'${message}'`),
      `the API never throws “${message}” (field ${field}) — the two have drifted`,
    )
  }
})
