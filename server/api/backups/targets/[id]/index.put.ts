import { store } from '../../../../utils/srvkit.ts'
import type { TargetInput } from '../../../../../lib/store.ts'
import {
  encryptPassword,
  isSafeTargetRoot,
  isValidHost,
  normalizeRoot,
  trimStr,
} from '../../../../utils/backups.ts'
import { isValidLocalRoot } from '../../../../utils/target-driver.ts'

// Update a target. A blank password means "keep the current one". A target's
// type is fixed at creation, so `type` in the body is ignored — the fields
// behind each type differ; switching means delete and re-create.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const existing = store().getTarget(id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Target not found' })
  }
  const isLocal = existing.type === 'local'

  const body = await readBody<Record<string, unknown>>(event)
  const fields: Partial<TargetInput> = {}

  if (body?.name !== undefined) {
    const v = trimStr(body.name)
    if (!v) {
      throw createError({ statusCode: 400, statusMessage: 'name must not be empty' })
    }
    fields.name = v
  }

  // A local target has no host or credentials — those fields stay empty.
  if (!isLocal) {
    for (const key of ['host', 'username'] as const) {
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
    if (typeof body?.password === 'string' && body.password.length > 0) {
      fields.password = encryptPassword(body.password)
    }
  }

  if (body?.rootDir !== undefined) {
    // Empty is allowed — it means the share root / the targets mount itself.
    const rootDir = normalizeRoot(body.rootDir)
    if (!isSafeTargetRoot(rootDir)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'root directory must stay inside the share',
      })
    }
    if (isLocal && !isValidLocalRoot(rootDir)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'directory is outside the allowed backup targets directory',
      })
    }
    fields.rootDir = rootDir
  }

  store().updateTarget(id, fields)
  const t = store().getTarget(id)!
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    host: t.host,
    username: t.username,
    rootDir: t.rootDir,
    createdAt: t.createdAt,
  }
})
