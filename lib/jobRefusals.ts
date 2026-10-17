/**
 * The ways a backup job can be refused for a missing or unusable field.
 *
 * Both sides need these: the API throws them, and the form pre-checks the same
 * things so a failed Save can mark the input at fault. They live here so there
 * is one wording and one field name per refusal — the form showing something
 * the API never says, or pointing at a field the API names differently, is the
 * bug this file exists to make impossible.
 *
 * Refusals only the server can reach (a file that is not a SQLite database, a
 * name already writing to that folder) are not here; nothing would share them.
 */
export interface JobRefusal {
  /** The form field at fault — what the API reports in `data.field`. */
  field: string
  message: string
}

export const JOB_REFUSALS = {
  container: { field: 'container', message: 'Select a container.' },
  database: { field: 'database', message: 'Database name is required.' },
  dbUser: { field: 'dbUser', message: 'Database user is required.' },
  dbPassword: { field: 'dbPassword', message: 'Database password is required.' },
  schedule: { field: 'schedule', message: 'A valid cron schedule is required.' },
  // One field, two refusals: the type decides whether it holds a file or a directory.
  sourceFile: { field: 'sourcePath', message: 'Select a source file.' },
  sourceDir: { field: 'sourcePath', message: 'Select a source directory.' },
  includes: { field: 'includes', message: 'Select at least one file to back up.' },
} as const satisfies Record<string, JobRefusal>
