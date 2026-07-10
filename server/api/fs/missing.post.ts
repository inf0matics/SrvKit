import { getMissingIncludes } from '../../utils/backups.ts'

// Given a source dir + a selection, report which selected paths no longer exist
// on disk (e.g. a file that was renamed) so the UI can offer to deselect them.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ sourcePath?: unknown; includes?: unknown }>(event)
  const sourcePath = typeof body?.sourcePath === 'string' ? body.sourcePath : ''
  const includes = Array.isArray(body?.includes)
    ? body.includes.filter((x): x is string => typeof x === 'string')
    : []
  return { missing: getMissingIncludes(sourcePath, includes) }
})
