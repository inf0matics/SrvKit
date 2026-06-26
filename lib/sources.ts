import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Backup sources are the directories mounted under the configured base (default
 * /backups, e.g. `/root` -> `/backups/root:ro`). A Files job picks one of these
 * and selects which files within it to back up.
 */

export interface TreeNode {
  name: string
  /** Path relative to the source root. */
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
}

/** Immediate sub-directories of `baseDir` (sources for Files jobs). */
export function listSources(baseDir: string): string[] {
  try {
    return readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

/** Immediate `.db` files of `baseDir` (sources for SQLite jobs). */
export function listDbFiles(baseDir: string): string[] {
  try {
    return readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.db'))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

export interface ChildNode {
  name: string
  /** Path relative to the base directory. */
  path: string
  type: 'file' | 'dir'
  /** Directories only: whether they contain anything (to show an expand arrow). */
  hasChildren?: boolean
}

/**
 * Direct children of `absDir` (one level, no recursion) — for the lazy file
 * tree. `relBase` is the dir's path relative to the mounted base. Symlinks are
 * skipped; directories are listed before files.
 */
export function listChildren(absDir: string, relBase: string): ChildNode[] {
  let entries
  try {
    entries = readdirSync(absDir, { withFileTypes: true })
  } catch {
    return []
  }

  entries.sort((a, b) => {
    const ad = a.isDirectory()
    const bd = b.isDirectory()
    if (ad !== bd) return ad ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const out: ChildNode[] = []
  for (const entry of entries) {
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      let hasChildren = false
      try {
        hasChildren = readdirSync(join(absDir, entry.name)).length > 0
      } catch {
        // unreadable dir -> no arrow
      }
      out.push({ name: entry.name, path: rel, type: 'dir', hasChildren })
    } else if (entry.isFile()) {
      out.push({ name: entry.name, path: rel, type: 'file' })
    }
  }
  return out
}

const MAX_ENTRIES = 5000

/**
 * Recursively build a file tree for `absDir`. Symlinks are skipped (only real
 * files/dirs), and the walk is capped to avoid pathological trees. Directories
 * are listed before files, each alphabetically.
 */
export function buildTree(
  absDir: string,
  relBase = '',
  counter = { count: 0 },
): TreeNode[] {
  let entries
  try {
    entries = readdirSync(absDir, { withFileTypes: true })
  } catch {
    return []
  }

  entries.sort((a, b) => {
    const ad = a.isDirectory()
    const bd = b.isDirectory()
    if (ad !== bd) return ad ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const nodes: TreeNode[] = []
  for (const entry of entries) {
    if (counter.count >= MAX_ENTRIES) break
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      counter.count++
      nodes.push({
        name: entry.name,
        path: rel,
        type: 'dir',
        children: buildTree(join(absDir, entry.name), rel, counter),
      })
    } else if (entry.isFile()) {
      counter.count++
      nodes.push({ name: entry.name, path: rel, type: 'file' })
    }
  }
  return nodes
}
