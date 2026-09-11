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

/**
 * Backup rotation: what SrvKit does with a job's older archives.
 *
 *   off  — SrvKit does not manage versions. Whether a run overwrites the last
 *          file or writes a new one is decided by the filename suffixes alone,
 *          and nothing is ever deleted.
 *   all  — every run is its own file (date and time), nothing is deleted.
 *   keep — every run is its own file, trimmed to the newest N after a success.
 *
 * `off` and `all` store the same keep count (0) because neither deletes
 * anything, so the choice itself is stored: it decides whether the suffixes
 * belong to the user or are fixed by the rotation.
 */
export type RetentionMode = 'off' | 'all' | 'keep'

const MODES: readonly RetentionMode[] = ['off', 'all', 'keep']

export interface RetentionColumns {
  rotation: RetentionMode
  dateSuffix: boolean
  timeSuffix: boolean
  keepVersions: number
}

/**
 * The stored columns a rotation implies. Under `off` the suffixes are the
 * user's own choice; both managed modes fix them on, because a version that
 * cannot be told apart from the last one is not a version.
 */
export function retentionColumns(
  mode: RetentionMode,
  keepVersions: number,
  suffixes: { dateSuffix: boolean; timeSuffix: boolean },
): RetentionColumns {
  if (mode === 'all' || mode === 'keep') {
    return {
      rotation: mode,
      dateSuffix: true,
      timeSuffix: true,
      keepVersions: mode === 'keep' ? Math.max(keepVersions, MIN_KEEP_VERSIONS) : 0,
    }
  }
  // A time on its own cannot order versions across days, so it needs the date.
  const dateSuffix = suffixes.dateSuffix
  return {
    rotation: 'off',
    dateSuffix,
    timeSuffix: dateSuffix && suffixes.timeSuffix,
    keepVersions: 0,
  }
}

/** The stored rotation, falling back to the mode that deletes nothing. */
export function retentionMode(rotation: string): RetentionMode {
  return MODES.includes(rotation as RetentionMode) ? (rotation as RetentionMode) : 'off'
}

/**
 * Whether a job's stored rotation makes sense. The form cannot produce these
 * combinations, but a stale client or a hand-crafted request must not create a
 * job that silently never cleans up — or one that claims a count it ignores.
 */
export function isValidRetention(cols: RetentionColumns): boolean {
  if (!MODES.includes(cols.rotation)) return false
  if (cols.timeSuffix && !cols.dateSuffix) return false
  if (cols.rotation === 'keep') {
    return cols.dateSuffix && cols.timeSuffix && cols.keepVersions >= MIN_KEEP_VERSIONS
  }
  // Nothing is deleted under off or all, so a keep count would be a lie.
  if (cols.keepVersions !== 0) return false
  if (cols.rotation === 'all') return cols.dateSuffix && cols.timeSuffix
  return true
}
