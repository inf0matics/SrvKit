import { realpathSync } from 'node:fs'
import { join, resolve, sep, dirname, basename, isAbsolute, normalize } from 'node:path'

/**
 * Path containment for every mounted directory SrvKit is pointed at — backup
 * sources (read-only) and backup destinations (writable). Both are configured
 * by an authenticated user, so a path that escapes its base is the difference
 * between reading or writing inside the mount and anywhere the container can
 * reach.
 */

/**
 * The deepest existing ancestor of `p`, canonicalized, with the not-yet-created
 * tail re-joined. Lets us compare real locations rather than spellings.
 */
function canonical(p: string): string {
  const tail: string[] = []
  let cur = p
  for (;;) {
    try {
      return join(realpathSync(cur), ...tail)
    } catch {
      const parent = dirname(cur)
      if (parent === cur) return p // walked to the root, nothing exists
      tail.unshift(basename(cur))
      cur = parent
    }
  }
}

/**
 * Resolve a base-relative path to an absolute one, or null if it escapes.
 *
 * Two checks, because they catch different escapes: the lexical one rejects
 * `../` even where nothing exists yet, and the canonical one rejects a symlink
 * inside the base that points out of it — `resolve()` does not follow links, so
 * spelling alone would call a symlinked directory contained when the bytes
 * would land somewhere else entirely.
 *
 * The returned path is the lexical one: callers get the location they asked
 * for, and only the containment decision is made on the canonical form.
 */
export function resolveWithin(base: string, rel: string): string | null {
  const root = resolve(base)
  const full = resolve(root, rel || '.')
  if (full !== root && !full.startsWith(root + sep)) return null
  const realRoot = canonical(root)
  const realFull = canonical(full)
  if (realFull !== realRoot && !realFull.startsWith(realRoot + sep)) return null
  return full
}

/**
 * Whether a relative path stays inside whatever it is joined onto, judged
 * without touching the filesystem. Used for paths that are stored now and
 * joined later — a job's sub-directory, a target's root — where the eventual
 * destination may be a remote share with no local path to canonicalize.
 * Empty is valid: it means "no sub-directory".
 */
export function isSafeRelPath(p: string): boolean {
  if (!p) return true
  if (isAbsolute(p)) return false
  const norm = normalize(p)
  return norm !== '..' && !norm.startsWith('..' + sep) && !norm.startsWith('../')
}
