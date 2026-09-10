import {
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
  unlinkSync,
} from 'node:fs'
import { join, resolve, sep, dirname, basename } from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * A local backup target writes to a directory on the host, mounted writable
 * into the container below one fixed base (BACKUP_TARGETS_DIR). Every path here
 * is relative to that base and is resolved through `resolveInBase()` first —
 * an authenticated user must not be able to make SrvKit write outside the
 * mount, the same guarantee `resolveSourcePath()` gives for backup sources.
 */

export interface LocalTestResult {
  ok: boolean
  message: string
}

export interface LocalBrowseResult {
  ok: boolean
  path: string
  dirs: string[]
  message?: string
}

/** Resolve a base-relative path to an absolute one, or null if it escapes. */
export function resolveInBase(base: string, rel: string): string | null {
  const root = resolve(base)
  const full = resolve(root, rel || '.')
  if (full !== root && !full.startsWith(root + sep)) return null
  return full
}

/** Resolve or throw — the shared guard for every write-side operation. */
function mustResolve(base: string, rel: string): string {
  const full = resolveInBase(base, rel)
  if (!full) throw new Error('Path is outside the allowed backup targets directory')
  return full
}

/** Turn an fs error into the reason a user can act on. */
function reason(e: unknown): string {
  const code = (e as NodeJS.ErrnoException).code
  if (code === 'ENOENT') return 'Directory not found'
  if (code === 'ENOTDIR') return 'Not a directory'
  if (code === 'EROFS') return 'Mounted read-only'
  if (code === 'EACCES' || code === 'EPERM') return 'Permission denied'
  return (e as Error).message || 'Write failed'
}

/**
 * Can SrvKit actually write here? Answered by creating a probe file and
 * removing it again — the only check that survives a read-only mount, a
 * restrictive owner or a directory that quietly isn't one.
 */
export function testLocalDir(base: string, rel: string): LocalTestResult {
  const full = resolveInBase(base, rel)
  if (!full) {
    return { ok: false, message: 'Path is outside the allowed backup targets directory' }
  }
  let stat
  try {
    stat = statSync(full)
  } catch (e) {
    return { ok: false, message: reason(e) }
  }
  if (!stat.isDirectory()) return { ok: false, message: 'Not a directory' }

  const probe = join(full, `.srvkit-write-test-${randomBytes(6).toString('hex')}`)
  try {
    writeFileSync(probe, '')
  } catch (e) {
    return { ok: false, message: reason(e) }
  }
  rmSync(probe, { force: true })
  return { ok: true, message: 'Directory is writable' }
}

/** Sub-directories of a base-relative path, for the root-directory picker. */
export function browseLocalDir(base: string, rel: string): LocalBrowseResult {
  const full = resolveInBase(base, rel)
  if (!full) {
    return {
      ok: false,
      path: rel,
      dirs: [],
      message: 'Path is outside the allowed backup targets directory',
    }
  }
  try {
    const dirs = readdirSync(full, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b))
    return { ok: true, path: rel, dirs }
  } catch (e) {
    return { ok: false, path: rel, dirs: [], message: reason(e) }
  }
}

/**
 * Write an archive at a base-relative destination, creating missing parents.
 * The write is atomic — a temp file in the same directory, then a rename — so a
 * crash mid-write can never leave a truncated file where a valid backup is
 * expected.
 */
export function uploadLocalFile(base: string, destPath: string, bytes: Uint8Array): void {
  const full = mustResolve(base, destPath)
  const dir = dirname(full)
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, `.${basename(full)}.tmp-${randomBytes(6).toString('hex')}`)
  try {
    writeFileSync(tmp, bytes)
    renameSync(tmp, full)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw new Error(reason(e), { cause: e })
  }
}

/**
 * File names directly inside a base-relative directory (retention, spec 19).
 * A directory that isn't there holds no versions — that is an empty list, not
 * an error, so a first run can never be tripped up by cleanup.
 */
export function listLocalFiles(base: string, dirPath: string): string[] {
  const full = mustResolve(base, dirPath)
  try {
    return readdirSync(full, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error(reason(e), { cause: e })
  }
}

/** Delete one base-relative file (retention, spec 19). */
export function deleteLocalFile(base: string, filePath: string): void {
  const full = mustResolve(base, filePath)
  try {
    unlinkSync(full)
  } catch (e) {
    throw new Error(reason(e), { cause: e })
  }
}
