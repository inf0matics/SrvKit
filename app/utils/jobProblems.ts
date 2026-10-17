import { JOB_REFUSALS, type JobRefusal } from '../../lib/jobRefusals.ts'
import { cronIsValid } from './cron.ts'

/**
 * What the job form is still missing, so a failed Save can mark the inputs
 * instead of only reporting that it failed.
 *
 * The API validates all of this too and is the authority — this only spares the
 * user a round trip and, more importantly, lets the answer point at a field.
 * Both sides raise the same `JOB_REFUSALS`, so the wording and the field names
 * cannot drift; the conditions below mirror `parseJobInput` by hand and have to
 * be changed with it.
 */
const blank = (s: string) => !s.trim()

/** The job form's fields, as far as validation is concerned. */
export interface JobFormFields {
  name: string
  type: string
  sourcePath: string
  trigger: string
  schedule: string
  container: string
  database: string
  dbUser: string
  dbPassword: string
}

/**
 * In the order the form shows the fields, so "the first problem" is also the
 * topmost one on screen.
 *
 * `hasStoredPassword` keeps a saved DB password out of the required set — the
 * field is left blank to keep it, which the PUT handler resolves.
 */
export function jobProblems(
  form: JobFormFields,
  includes: string[],
  hasStoredPassword: boolean,
): JobRefusal[] {
  const problems: JobRefusal[] = []
  const miss = (r: JobRefusal) => problems.push(r)

  // The API phrases a missing name for API callers ("name and targetId are
  // required"), which is no use under an input — hence the one local wording.
  if (blank(form.name)) miss({ field: 'name', message: 'A job name is required.' })

  if (form.type === 'postgres' || form.type === 'mysql') {
    if (blank(form.container)) miss(JOB_REFUSALS.container)
    if (blank(form.database)) miss(JOB_REFUSALS.database)
    if (blank(form.dbUser)) miss(JOB_REFUSALS.dbUser)
    if (blank(form.dbPassword) && !hasStoredPassword) miss(JOB_REFUSALS.dbPassword)
    // Container dumps are always cron-triggered.
    if (!cronIsValid(form.schedule)) miss(JOB_REFUSALS.schedule)
  } else if (form.type === 'sqlite') {
    if (blank(form.sourcePath)) miss(JOB_REFUSALS.sourceFile)
    if (form.trigger === 'cron' && !cronIsValid(form.schedule)) miss(JOB_REFUSALS.schedule)
  } else {
    if (blank(form.sourcePath)) miss(JOB_REFUSALS.sourceDir)
    if (includes.length === 0) miss(JOB_REFUSALS.includes)
  }

  return problems
}
