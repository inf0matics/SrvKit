import type { TargetSummary } from '~/composables/useTargets'

/**
 * Where a target writes, rendered for people: a host for a Nextcloud share, an
 * absolute-looking path for a local directory (which has no host at all).
 *
 * Both formatters live here because the same local/Nextcloud branch was
 * previously written out in four places and had already drifted — the job list
 * dropped the time suffix the edit page showed, so one job displayed two
 * different filenames depending on which page you were on.
 */
export function targetDestination(target: TargetSummary): string {
  return target.type === 'local' ? '/' + target.rootDir : target.host
}

/** Host without scheme or trailing slash; empty for a local target. */
function targetPrefix(target: TargetSummary): string {
  if (target.type === 'local') return ''
  return target.host.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

export interface ArchiveNaming {
  name: string
  subdirectory: string
  dateSuffix: boolean
  timeSuffix: boolean
}

/** The archive filename a job produces: `<name>[_date][_time].tar.gz`. */
export function archiveName(job: ArchiveNaming, date = new Date()): string {
  const iso = date.toISOString()
  const datePart = job.dateSuffix ? `_${iso.slice(0, 10)}` : ''
  const timePart = job.timeSuffix ? `_${iso.slice(11, 19).replace(/:/g, '-')}` : ''
  return `${job.name || 'job'}${datePart}${timePart}.tar.gz`
}

/** Full destination of a job's archive on its target, as shown in the UI. */
export function targetArchivePath(
  target: TargetSummary | undefined,
  job: ArchiveNaming,
  date = new Date(),
): string {
  const isLocal = target?.type === 'local'
  const segs = [
    target ? targetPrefix(target) : '',
    target?.rootDir ?? '',
    job.subdirectory,
  ].filter(Boolean)
  return (isLocal ? '/' : '') + [...segs, archiveName(job, date)].join('/')
}
