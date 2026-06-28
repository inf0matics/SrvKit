import { join } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { JobRecord } from '../../lib/store.ts'
import { store } from './srvkit.ts'
import { sourcesDir } from './backups.ts'
import { runBackup, isRunning } from './runner.ts'

// Debounce so a burst of changes (e.g. an editor saving several files) fires a
// single backup once things settle. Fixed at 10s in v1.
const DEBOUNCE_MS = 10_000

interface Entry {
  watcher: FSWatcher
  timer?: ReturnType<typeof setTimeout>
  /** Epoch ms when the pending run will fire; undefined when not debouncing. */
  debounceUntil?: number
}

const watchers = new Map<string, Entry>()

/** Milliseconds left on a job's debounce timer (0 when not debouncing). */
export function debounceRemainingMs(id: string): number {
  const until = watchers.get(id)?.debounceUntil
  return until ? Math.max(0, until - Date.now()) : 0
}

export type JobState = 'never' | 'debouncing' | 'running' | 'success' | 'failed'

/** Live runtime state for a job, for the status column. */
export function jobState(job: JobRecord): {
  running: boolean
  state: JobState
  remainingMs: number
} {
  const running = isRunning(job.id)
  const remainingMs = running ? 0 : debounceRemainingMs(job.id)
  const state: JobState = running
    ? 'running'
    : remainingMs > 0
      ? 'debouncing'
      : (job.lastStatus ?? 'never')
  return { running, state, remainingMs }
}

/** (Re-)register the filewatcher for an active, filewatcher-triggered job. */
export function registerJob(job: JobRecord) {
  unregisterJob(job.id)
  if (!job.active) return
  // Container DB dumps + cron-triggered SQLite jobs fire on a schedule.
  if (
    job.type === 'postgres' ||
    job.type === 'mysql' ||
    (job.type === 'sqlite' && job.trigger === 'cron')
  )
    return

  // Files: watch each selected path. SQLite: watch the source .db file.
  const sourceAbs = join(sourcesDir(), job.sourcePath)
  const watchPaths =
    job.type === 'sqlite'
      ? [sourceAbs]
      : job.includes.map((i) => join(sourceAbs, i))
  if (watchPaths.length === 0) return

  const watcher = chokidar.watch(watchPaths, { ignoreInitial: true })
  const entry: Entry = { watcher }
  watcher.on('all', () => {
    if (entry.timer) clearTimeout(entry.timer)
    entry.debounceUntil = Date.now() + DEBOUNCE_MS
    entry.timer = setTimeout(() => {
      entry.debounceUntil = undefined
      void runBackup(job.id)
    }, DEBOUNCE_MS)
  })
  watchers.set(job.id, entry)
}

export function unregisterJob(id: string) {
  const entry = watchers.get(id)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  void entry.watcher.close()
  watchers.delete(id)
}

/** Re-register watchers for every active job (called on server startup). */
export function registerAllJobs() {
  for (const job of store().listJobs()) if (job.active) registerJob(job)
}
