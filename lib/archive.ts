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
