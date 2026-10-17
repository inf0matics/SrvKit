import { cronIsValid } from './cron.ts'

/**
 * What the job form is still missing, so a failed Save can mark the inputs
 * instead of only reporting that it failed.
 *
 * The API validates all of this too and is the authority — this only spares the
 * user a round trip and, more importantly, lets the answer point at a field.
 * The messages are therefore the API's own wording, verbatim; a unit test holds
 * the two together.
 */
export interface JobProblem {
  /** The key of the form field at fault — also what the API reports in `data.field`. */
  field: string
  message: string
}

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

const blank = (s: string) => !s.trim()

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
): JobProblem[] {
  const problems: JobProblem[] = []
  const miss = (field: string, message: string) => problems.push({ field, message })

  if (blank(form.name)) miss('name', 'A job name is required.')

  if (form.type === 'postgres' || form.type === 'mysql') {
    if (blank(form.container)) miss('container', 'Select a container.')
    if (blank(form.database)) miss('database', 'Database name is required.')
    if (blank(form.dbUser)) miss('dbUser', 'Database user is required.')
    if (blank(form.dbPassword) && !hasStoredPassword) {
      miss('dbPassword', 'Database password is required.')
    }
    // Container dumps are always cron-triggered.
    if (!cronIsValid(form.schedule)) miss('schedule', 'A valid cron schedule is required.')
  } else if (form.type === 'sqlite') {
    if (blank(form.sourcePath)) miss('sourcePath', 'Select a source file.')
    if (form.trigger === 'cron' && !cronIsValid(form.schedule)) {
      miss('schedule', 'A valid cron schedule is required.')
    }
  } else {
    if (blank(form.sourcePath)) miss('sourcePath', 'Select a source directory.')
    if (includes.length === 0) miss('includes', 'Select at least one file to back up.')
  }

  return problems
}
