/**
 * Retention decides which of a job's archives to delete after a successful run,
 * keeping the newest N. It is deliberately pure: given the file names in a
 * directory, a job name and N, it says exactly what goes.
 *
 * The whole safety story is the anchored pattern. A job named `db` must never
 * match `db-old_2026-01-01.tar.gz` or `db_notes.tar.gz`, and two jobs sharing a
 * directory must not delete each other's archives — so the job name is escaped
 * and the pattern is anchored at both ends.
 */

/** The lowest keep count the UI offers. Below it, retention is off. */
export const MIN_KEEP_VERSIONS = 2

/** Escape a job name so it can sit inside a regular expression literally. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `<name>_YYYY-MM-DD[_HH-MM-SS].tar.gz`, and nothing else. */
function archivePattern(jobName: string): RegExp {
  return new RegExp(
    `^${escapeRegExp(jobName)}_(\\d{4}-\\d{2}-\\d{2})(_\\d{2}-\\d{2}-\\d{2})?\\.tar\\.gz$`,
  )
}

/**
 * Sort key for an archive name. A date-only archive stands for the start of its
 * day, so it sorts before a timed archive from the same day. Both parts are
 * zero-padded, so comparing the strings compares the instants.
 */
function timestampOf(match: RegExpMatchArray): string {
  return match[1]! + (match[2] ?? '_00-00-00')
}

/**
 * Which of `files` to delete so that at most `keep` of this job's archives
 * remain, newest first by the timestamp in the name — never by modification
 * time, which is unreliable across WebDAV and wrong after any restore or copy.
 *
 * `currentArchive` is the file the run just wrote; it is never a candidate.
 *
 * The result reduces to the target count rather than removing "the one extra
 * file", which makes retention idempotent and self-healing: a run that could
 * not clean up leaves the next one to trim the whole backlog.
 */
export function archivesToDelete(
  files: string[],
  jobName: string,
  keep: number,
  currentArchive = '',
): string[] {
  // 0 means off, and 1 is never offered — treat anything below the minimum as
  // off rather than as a licence to delete more.
  if (keep < MIN_KEEP_VERSIONS) return []

  const pattern = archivePattern(jobName)
  const archives: { name: string; at: string }[] = []
  for (const name of files) {
    if (name === currentArchive) continue
    const m = name.match(pattern)
    if (m) archives.push({ name, at: timestampOf(m) })
  }

  // Newest first; the file name breaks ties so the order is deterministic.
  archives.sort((a, b) => (b.at === a.at ? b.name.localeCompare(a.name) : b.at < a.at ? -1 : 1))

  // The current run's archive counts towards the kept versions even though it
  // was excluded above — it is always one of the newest.
  const room = currentArchive && files.includes(currentArchive) ? keep - 1 : keep
  return archives.slice(Math.max(room, 0)).map((a) => a.name)
}
