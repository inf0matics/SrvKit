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
