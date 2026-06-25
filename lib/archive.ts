import { create } from 'tar'

/** Pack a single file (in `fileDir`) into a gzipped tar at `outFile`. */
export async function createFileArchive(
  fileDir: string,
  fileName: string,
  outFile: string,
): Promise<void> {
  await create({ gzip: true, file: outFile, cwd: fileDir }, [fileName])
}

/**
 * Pack the selected files of a source directory into a gzipped tar at `outFile`,
 * preserving relative paths. `excludes` are paths (relative to `sourceDir`) to
 * skip — a directory exclude skips its whole subtree.
 */
export async function createArchive(
  sourceDir: string,
  excludes: string[],
  outFile: string,
): Promise<void> {
  const excluded = new Set(excludes)
  await create(
    {
      gzip: true,
      file: outFile,
      cwd: sourceDir,
      // Skip excluded paths (and anything beneath an excluded directory).
      filter: (path) => {
        const rel = path.replace(/^\.\/?/, '').replace(/\/$/, '')
        if (!rel) return true
        for (const ex of excluded) {
          if (rel === ex || rel.startsWith(ex + '/')) return false
        }
        return true
      },
    },
    ['.'],
  )
}
