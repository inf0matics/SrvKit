import { store } from '../../../utils/srvkit.ts'
import { getSources, normalizeRoot, trimStr } from '../../../utils/backups.ts'

// Create a Files backup job. The filewatcher that acts on it is spec 06.
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const name = trimStr(body?.name)
  const targetId = trimStr(body?.targetId)
  const type = trimStr(body?.type) || 'files'
  const sourcePath = trimStr(body?.sourcePath)
  const output = trimStr(body?.output) || 'single'
  const subdirectory = normalizeRoot(body?.subdirectory)
  const excludes = Array.isArray(body?.excludes)
    ? (body.excludes as unknown[]).filter((e): e is string => typeof e === 'string')
    : []

  if (!name || !targetId || !sourcePath) {
    throw createError({
      statusCode: 400,
      statusMessage: 'name, targetId and sourcePath are required',
    })
  }
  if (type !== 'files') {
    throw createError({ statusCode: 400, statusMessage: 'unsupported job type' })
  }
  if (!store().getTarget(targetId)) {
    throw createError({ statusCode: 400, statusMessage: 'unknown target' })
  }
  if (!getSources().includes(sourcePath)) {
    throw createError({ statusCode: 400, statusMessage: 'unknown source path' })
  }

  return store().createJob({
    targetId,
    name,
    type,
    sourcePath,
    excludes,
    output,
    subdirectory,
  })
})
