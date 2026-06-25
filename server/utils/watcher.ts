import { join } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { JobRecord } from '../../lib/store.ts'
import { store } from './srvkit.ts'
import { sourcesDir } from './backups.ts'
import { runBackup } from './runner.ts'

// Debounce so a burst of changes (e.g. an editor saving several files) fires a
// single backup once things settle. Fixed at 10s in v1.
const DEBOUNCE_MS = 10_000

interface Entry {
  watcher: FSWatcher
  timer?: ReturnType<typeof setTimeout>
}

const watchers = new Map<string, Entry>()

/** (Re-)register the filewatcher for a job over its selected files. */
export function registerJob(job: JobRecord) {
  unregisterJob(job.id)
  const sourceDir = join(sourcesDir(), job.sourcePath)
  const excluded = job.excludes.map((ex) => join(sourceDir, ex))

  const watcher = chokidar.watch(sourceDir, {
    ignoreInitial: true, // no backup on (re-)registration
    ignored: (p: string) =>
      excluded.some((ex) => p === ex || p.startsWith(ex + '/')),
  })

  const entry: Entry = { watcher }
  watcher.on('all', () => {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => void runBackup(job.id), DEBOUNCE_MS)
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

/** Re-register watchers for every stored job (called on server startup). */
export function registerAllJobs() {
  for (const job of store().listJobs()) registerJob(job)
}
