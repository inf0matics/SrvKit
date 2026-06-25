import { getSourceTree } from '../../../../utils/backups.ts'

// File tree of a source directory (for selecting files in the wizard).
export default defineEventHandler((event) => {
  const name = getRouterParam(event, 'name')!
  const tree = getSourceTree(name)
  if (tree === null) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown source' })
  }
  return { tree }
})
