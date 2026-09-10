import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readFileSync,
  writeFileSync,
  rmSync,
  mkdtempSync,
  existsSync,
  statSync,
} from 'node:fs'
import { store } from './srvkit.ts'
import { archiveFilename, decryptPassword, sourcesDir } from './backups.ts'
import { driverForTarget, type TargetDriver } from './target-driver.ts'
import { archivesToDelete, MIN_KEEP_VERSIONS } from '../../lib/retention.ts'
import { createArchive, createFileArchive, contentBytes } from '../../lib/archive.ts'
import { backupSqliteFile } from '../../lib/sqlite-backup.ts'
import { dockerAvailable, pgDump, mysqlDump } from './docker.ts'
import { handleRunResult } from './alerts.ts'
import type { RunResult, JobRecord } from '../../lib/store.ts'

// In-memory set of jobs currently running. Runtime-only (a run interrupted by a
// restart should not look "running" forever — startup clears this naturally).
const runningJobs = new Set<string>()

export function isRunning(id: string): boolean {
  return runningJobs.has(id)
}

/**
 * Delete this job's older archives, keeping the newest N. Retention is a
 * cleanup step, not the backup: a failure here is logged and the run stays
 * green, because the archive is safely written and failing the run would raise
 * an alert about data that is fine. Nothing is retried — the next run trims to
 * N anyway, since selection reduces to the target count rather than removing
 * one extra file.
 */
async function pruneVersions(
  job: JobRecord,
  driver: TargetDriver,
  dir: string,
  currentArchive: string,
): Promise<void> {
  if (job.keepVersions < MIN_KEEP_VERSIONS) return
  // Archives are matched by the job's name, so a second job writing the same
  // names into the same directory is indistinguishable from our own history —
  // and its files would be deleted as ours. Decline to clean up instead.
  if (hasNameTwin(job)) {
    return noteCleanup(job.id, `Skipped: another job writes "${job.name}" to the same folder`)
  }
  try {
    const files = await driver.list(dir)
    for (const name of archivesToDelete(files, job.name, job.keepVersions, currentArchive)) {
      await driver.delete((dir ? dir + '/' : '') + name)
    }
    noteCleanup(job.id, null)
  } catch (e) {
    const message = (e as Error).message
    console.error(`[backup] retention failed for job "${job.name}": ${message}`)
    // Recorded on the job as well as logged: the run stays green on purpose, so
    // a log line alone would let a target fill up with nobody ever told.
    noteCleanup(job.id, message)
  }
}

/** Another job writing this job's archive names into the same directory. */
function hasNameTwin(job: JobRecord): boolean {
  return store()
    .listJobs()
    .some(
      (other) =>
        other.id !== job.id &&
        other.name === job.name &&
        other.targetId === job.targetId &&
        other.subdirectory === job.subdirectory,
    )
}

/** Record why cleanup could not run (or clear it). Never throws. */
function noteCleanup(jobId: string, error: string | null): void {
  try {
    store().setJobCleanupError(jobId, error)
  } catch {
    // Cleanup bookkeeping must never be able to fail a good run.
  }
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
  // A trigger landing mid-run must not start a second execution: two runs would
  // prune against each other's stale listings and can delete below keepVersions.
  if (runningJobs.has(jobId)) return

  runningJobs.add(jobId)
  const at = new Date().toISOString()
  const work = mkdtempSync(join(tmpdir(), 'srvkit-run-'))
  // Record the result, then run the alert state machine (never throws).
  const finish = async (result: RunResult) => {
    store().recordRun(jobId, result)
    await handleRunResult(jobId, result)
  }
  const fail = (error: string, bytes?: number) =>
    finish({ at, status: 'failed', error, bytes: bytes ?? null })

  // A command that writes nothing and exits 0 yields a small, valid, empty
  // archive and a green job row — how a backup can run into the void for weeks.
  // Measure the raw content, and refuse to upload when there is none: with date
  // suffixes off the target filename is static, so a bad run would otherwise
  // overwrite the last good backup.
  const EMPTY = 'Dump produced 0 bytes — nothing was backed up'

  try {
    const target = store().getTarget(job.targetId)
    if (!target) return fail('Target not found')

    const tarPath = join(work, 'archive.tar.gz')
    let bytes = 0

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
      bytes = statSync(join(work, dbName)).size
      if (bytes === 0) return fail(EMPTY, 0)
      try {
        await createFileArchive(work, dbName, tarPath)
      } catch (e) {
        return fail(`Archive failed: ${(e as Error).message}`)
      }
    } else if (job.type === 'postgres' || job.type === 'mysql') {
      if (!dockerAvailable()) return fail('Docker socket not accessible')
      const isMysql = job.type === 'mysql'
      const sqlName = job.name.replace(/[\\/]/g, '_') + '.sql'
      const opts = {
        container: job.container,
        database: job.database,
        user: job.dbUser,
        password: decryptPassword(job.dbPassword),
      }
      let dump: Buffer
      try {
        dump = isMysql ? await mysqlDump(opts) : await pgDump(opts)
      } catch (e) {
        // The mysql message already names the resolved binary (or that none was found).
        return fail(`${isMysql ? 'Dump' : 'pg_dump'} failed: ${(e as Error).message}`)
      }
      bytes = dump.length
      if (bytes === 0) return fail(EMPTY, 0)
      try {
        writeFileSync(join(work, sqlName), dump)
        await createFileArchive(work, sqlName, tarPath)
      } catch (e) {
        return fail(`Archive failed: ${(e as Error).message}`)
      }
    } else {
      const srcDir = join(sourcesDir(), job.sourcePath)
      bytes = contentBytes(srcDir, job.includes)
      if (bytes === 0) return fail(EMPTY, 0)
      try {
        await createArchive(srcDir, job.includes, tarPath)
      } catch (e) {
        return fail(`Archive failed: ${(e as Error).message}`)
      }
    }

    // 2. Upload.
    try {
      const body = readFileSync(tarPath)
      const dir = [target.rootDir, job.subdirectory].filter(Boolean).join('/')
      const filename = archiveFilename(job.name, job.dateSuffix, job.timeSuffix)
      const driver = driverForTarget(target)
      await driver.upload((dir ? dir + '/' : '') + filename, body)
      // Record the good backup before cleaning up: a crash during retention
      // must not lose the record of an archive that is already safely written.
      await finish({ at, status: 'success', error: null, bytes })
      // 3. Retention — never after a failed run: a failed backup must not be
      //    able to delete a good one. Never throws.
      await pruneVersions(job, driver, dir, filename)
    } catch (e) {
      await fail(`Upload failed: ${(e as Error).message}`, bytes)
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
    runningJobs.delete(jobId)
  }
}
