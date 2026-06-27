import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs'
import { store } from './srvkit.ts'
import {
  archiveFilename,
  decryptPassword,
  sourcesDir,
  uploadToWebdav,
} from './backups.ts'
import { createArchive, createFileArchive } from '../../lib/archive.ts'
import { backupSqliteFile } from '../../lib/sqlite-backup.ts'
import { dockerAvailable, pgDump } from './docker.ts'
import { handleRunResult } from './alerts.ts'
import type { RunResult } from '../../lib/store.ts'

// In-memory set of jobs currently running. Runtime-only (a run interrupted by a
// restart should not look "running" forever — startup clears this naturally).
const runningJobs = new Set<string>()

export function isRunning(id: string): boolean {
  return runningJobs.has(id)
}

/**
 * Run a backup job: produce a tar.gz of the selected files (Files) or an online
 * copy of the source database (SQLite) and upload it to the target. The result
 * (success/failure + error) is written to the DB. Never throws — failures are
 * recorded, not propagated.
 */
export async function runBackup(jobId: string): Promise<void> {
  const job = store().getJob(jobId)
  if (!job) return

  runningJobs.add(jobId)
  const at = new Date().toISOString()
  const work = mkdtempSync(join(tmpdir(), 'srvkit-run-'))
  // Record the result, then run the alert state machine (never throws).
  const finish = async (result: RunResult) => {
    store().recordRun(jobId, result)
    await handleRunResult(jobId, result)
  }
  const fail = (error: string) => finish({ at, status: 'failed', error })

  try {
    const target = store().getTarget(job.targetId)
    if (!target) return fail('Target not found')

    const tarPath = join(work, 'archive.tar.gz')

    // 1. Produce the archive.
    if (job.type === 'sqlite') {
      const srcFile = join(sourcesDir(), job.sourcePath)
      if (!existsSync(srcFile)) return fail('Source file not found')
      const dbName = job.name.replace(/[\\/]/g, '_') + '.db'
      try {
        await backupSqliteFile(srcFile, join(work, dbName))
      } catch (e) {
        return fail(`Backup failed: ${(e as Error).message}`)
      }
      try {
        await createFileArchive(work, dbName, tarPath)
      } catch (e) {
        return fail(`Archive failed: ${(e as Error).message}`)
      }
    } else if (job.type === 'postgres') {
      if (!dockerAvailable()) return fail('Docker socket not accessible')
      const sqlName = job.name.replace(/[\\/]/g, '_') + '.sql'
      let dump: Buffer
      try {
        dump = await pgDump({
          container: job.container,
          database: job.database,
          user: job.dbUser,
          password: decryptPassword(job.dbPassword),
        })
      } catch (e) {
        return fail(`pg_dump failed: ${(e as Error).message}`)
      }
      try {
        writeFileSync(join(work, sqlName), dump)
        await createFileArchive(work, sqlName, tarPath)
      } catch (e) {
        return fail(`Archive failed: ${(e as Error).message}`)
      }
    } else {
      try {
        await createArchive(join(sourcesDir(), job.sourcePath), job.includes, tarPath)
      } catch (e) {
        return fail(`Archive failed: ${(e as Error).message}`)
      }
    }

    // 2. Upload.
    try {
      const body = readFileSync(tarPath)
      const password = decryptPassword(target.password)
      const dir = [target.rootDir, job.subdirectory].filter(Boolean).join('/')
      const destPath =
        (dir ? dir + '/' : '') +
        archiveFilename(job.name, job.dateSuffix, job.timeSuffix)
      await uploadToWebdav(target.host, target.username, password, destPath, body)
      await finish({ at, status: 'success', error: null })
    } catch (e) {
      await fail(`Upload failed: ${(e as Error).message}`)
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
    runningJobs.delete(jobId)
  }
}
