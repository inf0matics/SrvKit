import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { store } from './srvkit.ts'
import { decryptPassword, sourcesDir, uploadToWebdav } from './backups.ts'
import { createArchive } from '../../lib/archive.ts'

// In-memory set of jobs currently running. Runtime-only (a run interrupted by a
// restart should not look "running" forever — startup clears this naturally).
const runningJobs = new Set<string>()

export function isRunning(id: string): boolean {
  return runningJobs.has(id)
}

/**
 * Run a backup job: pack the selected files into a tar.gz and upload it to the
 * target. The result (success/failure + error) is written to the DB. Never
 * throws — failures are recorded, not propagated.
 */
export async function runBackup(jobId: string): Promise<void> {
  const job = store().getJob(jobId)
  if (!job) return

  runningJobs.add(jobId)
  const at = new Date().toISOString()
  try {
    const target = store().getTarget(job.targetId)
    if (!target) {
      store().recordRun(jobId, { at, status: 'failed', error: 'Target not found' })
      return
    }

    const sourceDir = join(sourcesDir(), job.sourcePath)
    const tmp = join(tmpdir(), `srvkit-${jobId}-${randomUUID()}.tar.gz`)
    try {
      try {
        await createArchive(sourceDir, job.excludes, tmp)
      } catch (e) {
        store().recordRun(jobId, {
          at,
          status: 'failed',
          error: `Archive failed: ${(e as Error).message}`,
        })
        return
      }

      try {
        const body = readFileSync(tmp)
        const password = decryptPassword(target.password)
        const dir = [target.rootDir, job.subdirectory].filter(Boolean).join('/')
        const destPath = (dir ? dir + '/' : '') + `${job.name}.tar.gz`
        await uploadToWebdav(target.host, target.username, password, destPath, body)
        store().recordRun(jobId, { at, status: 'success', error: null })
      } catch (e) {
        store().recordRun(jobId, {
          at,
          status: 'failed',
          error: `Upload failed: ${(e as Error).message}`,
        })
      }
    } finally {
      rmSync(tmp, { force: true })
    }
  } finally {
    runningJobs.delete(jobId)
  }
}
