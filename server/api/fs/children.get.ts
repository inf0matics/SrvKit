import { getChildren } from '../../utils/backups.ts'

// Direct children of a mounted path (lazy file tree). ?path= is base-relative.
export default defineEventHandler((event) => {
  const path = String(getQuery(event).path ?? '')
  const children = getChildren(path)
  if (children === null) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid path' })
  }
  return { children }
})
