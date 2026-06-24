import { store } from '../../../../utils/srvkit.ts'
import type { TargetInput } from '../../../../../lib/store.ts'
import {
  encryptPassword,
  isValidHost,
  normalizeRoot,
  trimStr,
} from '../../../../utils/backups.ts'

// Update a target. A blank password means "keep the current one".
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  if (!store().getTarget(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Target not found' })
  }

  const body = await readBody<Record<string, unknown>>(event)
  const fields: Partial<TargetInput> = {}

  for (const key of ['name', 'host', 'username'] as const) {
    if (body?.[key] !== undefined) {
      const v = trimStr(body[key])
      if (!v) {
        throw createError({ statusCode: 400, statusMessage: `${key} must not be empty` })
      }
      if (key === 'host' && !isValidHost(v)) {
        throw createError({ statusCode: 400, statusMessage: 'host must be an http(s) URL' })
      }
      fields[key] = v
    }
  }
  if (body?.rootDir !== undefined) {
    // Empty is allowed — it means the share root ("/").
    fields.rootDir = normalizeRoot(body.rootDir)
  }
  if (typeof body?.password === 'string' && body.password.length > 0) {
    fields.password = encryptPassword(body.password)
  }

  store().updateTarget(id, fields)
  const t = store().getTarget(id)!
  return {
    id: t.id,
    name: t.name,
    host: t.host,
    username: t.username,
    rootDir: t.rootDir,
    createdAt: t.createdAt,
  }
})
