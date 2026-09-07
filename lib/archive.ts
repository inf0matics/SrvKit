import { create } from 'tar'
import { statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Pack a single file (in `fileDir`) into a gzipped tar at `outFile`. */
export async function createFileArchive(
  fileDir: string,
  fileName: string,
  outFile: string,
): Promise<void> {
  await create({ gzip: true, file: outFile, cwd: fileDir }, [fileName])
}

/**
 * Pack the selected paths of a source directory into a gzipped tar at `outFile`,
 * preserving relative paths. `includes` are paths (relative to `sourceDir`);
 * a directory include packs its whole subtree.
 */
export async function createArchive(
  sourceDir: string,
  includes: string[],
  outFile: string,
): Promise<void> {
  await create({ gzip: true, file: outFile, cwd: sourceDir }, includes)
}

/**
 * Total bytes of the regular files `includes` covers, relative to `sourceDir`
 * (directories are walked). This is the raw content size, not the size of the
 * gzipped archive — an archive of nothing is still ~20 bytes, so only the raw
 * count can tell "backed up nothing" from "backed up a little". Unreadable or
 * missing entries count as 0 rather than throwing; the archive step reports those.
 */
export function contentBytes(sourceDir: string, includes: string[]): number {
  let total = 0
  const visit = (rel: string) => {
    const abs = join(sourceDir, rel)
    let st
    try {
      st = statSync(abs)
    } catch {
      return // missing / unreadable — createArchive surfaces it
    }
    if (st.isDirectory()) {
      for (const entry of readdirSync(abs)) visit(join(rel, entry))
    } else if (st.isFile()) {
      total += st.size
    }
  }
  for (const inc of includes) visit(inc)
  return total
}
