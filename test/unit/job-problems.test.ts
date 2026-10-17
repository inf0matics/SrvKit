import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jobProblems, type JobFormFields } from '../../app/utils/jobProblems.ts'
import { JOB_REFUSALS } from '../../lib/jobRefusals.ts'

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
  assert.deepEqual(jobProblems(full, ['some-file'], false), [])
})

/**
 * The form and the API raise the same refusals, so neither can word a field
 * differently from the other — the entries themselves are shared, not copied.
 */
test('the problems are the shared refusals the API throws', () => {
  const pg = jobProblems({ ...base, type: 'postgres' }, [], false)
  assert.equal(pg[0], JOB_REFUSALS.container)
  assert.equal(pg[4], JOB_REFUSALS.schedule)
  assert.equal(jobProblems(base, [], false)[0], JOB_REFUSALS.sourceDir)
  assert.equal(jobProblems({ ...base, type: 'sqlite' }, [], false)[0], JOB_REFUSALS.sourceFile)
})
