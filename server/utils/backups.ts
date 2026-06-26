import { join, resolve, sep } from 'node:path'
import { createError } from 'h3'
import { encrypt, decrypt } from '../../lib/crypto.ts'
import {
  listSources,
  listDbFiles,
  listChildren,
  buildTree,
  type TreeNode,
  type ChildNode,
} from '../../lib/sources.ts'
import type { JobInput } from '../../lib/store.ts'
import { isSqliteFile } from '../../lib/sqlite-backup.ts'
import { store } from './srvkit.ts'

/** Base directory holding the mounted backup sources. */
export function sourcesDir(): string {
  return process.env.BACKUP_SOURCES_DIR || '/backups'
}

/** Source directories (Files jobs). */
export function getSources(): string[] {
  return listSources(sourcesDir())
}

/** Source .db files (SQLite jobs). */
export function getDbSources(): string[] {
  return listDbFiles(sourcesDir())
}

/** Archive filename for a job, with optional YYYY-MM-DD suffix. */
export function archiveFilename(
  name: string,
  dateSuffix: boolean,
  date = new Date(),
): string {
  const suffix = dateSuffix ? `_${date.toISOString().slice(0, 10)}` : ''
  return `${name}${suffix}.tar.gz`
}

/** File tree for a source, or null if the name isn't a known source. */
export function getSourceTree(name: string): TreeNode[] | null {
  if (!getSources().includes(name)) return null
  return buildTree(join(sourcesDir(), name))
}

/** Resolve a base-relative path to an absolute path, or null if it escapes. */
export function resolveSourcePath(rel: string): string | null {
  const base = resolve(sourcesDir())
  const full = resolve(base, rel || '.')
  if (full !== base && !full.startsWith(base + sep)) return null
  return full
}

/** Direct children of a base-relative path (lazy tree), or null if invalid. */
export function getChildren(rel: string): ChildNode[] | null {
  const full = resolveSourcePath(rel)
  if (!full) return null
  return listChildren(full, rel)
}

/** Validate + normalize a job request body (shared by create and update). */
export function parseJobInput(body: Record<string, unknown> | null): JobInput {
  const name = trimStr(body?.name)
  const targetId = trimStr(body?.targetId)
  const type = trimStr(body?.type) || 'files'
  const sourcePath = trimStr(body?.sourcePath)
  const output = trimStr(body?.output) || 'single'
  const subdirectory = normalizeRoot(body?.subdirectory)
  const dateSuffix = body?.dateSuffix === true
  const excludes = Array.isArray(body?.excludes)
    ? (body.excludes as unknown[]).filter((e): e is string => typeof e === 'string')
    : []

  if (!name || !targetId || !sourcePath) {
    throw createError({
      statusCode: 400,
      statusMessage: 'name, targetId and sourcePath are required',
    })
  }
  if (type !== 'files' && type !== 'sqlite') {
    throw createError({ statusCode: 400, statusMessage: 'unsupported job type' })
  }
  if (!store().getTarget(targetId)) {
    throw createError({ statusCode: 400, statusMessage: 'unknown target' })
  }
  if (type === 'sqlite') {
    // Any mounted file that passes the SQLite header check is a valid source.
    const abs = resolveSourcePath(sourcePath)
    if (!abs) {
      throw createError({ statusCode: 400, statusMessage: 'unknown source path' })
    }
    if (!isSqliteFile(abs)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'The selected file is not a valid SQLite database.',
      })
    }
  } else if (!getSources().includes(sourcePath)) {
    throw createError({ statusCode: 400, statusMessage: 'unknown source path' })
  }

  return { targetId, name, type, sourcePath, excludes, output, subdirectory, dateSuffix }
}

export function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export function isValidHost(host: string): boolean {
  return /^https?:\/\/.+/.test(host)
}

/** Trim whitespace and strip leading/trailing slashes for clean path joins. */
export function normalizeRoot(root: unknown): string {
  return trimStr(root).replace(/^\/+|\/+$/g, '')
}

export function encryptPassword(plain: string): string {
  return encrypt(plain)
}

export function decryptPassword(blob: string): string {
  return decrypt(blob)
}

export interface TestResult {
  ok: boolean
  message: string
}

export interface BrowseResult {
  ok: boolean
  path: string
  dirs: string[]
  message?: string
}

/**
 * Parse a WebDAV PROPFIND (Depth 1) multistatus response into the names of the
 * immediate child collections (directories) of `path`. Namespace-agnostic so it
 * copes with `d:` / `D:` prefixes; the queried folder's own entry is skipped.
 */
export function parseDirs(xml: string, username: string, path: string): string[] {
  const prefix = `/remote.php/dav/files/${username}/${path ? path + '/' : ''}`
  const blocks = xml.split(/<(?:[a-z0-9]+:)?response[\s>]/i).slice(1)
  const dirs: string[] = []
  for (const block of blocks) {
    if (!/<(?:[a-z0-9]+:)?collection\s*\/?>/i.test(block)) continue
    const m = block.match(/<(?:[a-z0-9]+:)?href>([^<]*)<\/(?:[a-z0-9]+:)?href>/i)
    if (!m) continue
    let href = m[1]!
    if (/^https?:\/\//i.test(href)) {
      try {
        href = new URL(href).pathname
      } catch {
        // keep raw href
      }
    }
    href = decodeURIComponent(href)
    if (!href.startsWith(prefix)) continue
    const rel = href.slice(prefix.length).replace(/\/$/, '')
    if (!rel || rel.includes('/')) continue // self or deeper than one level
    dirs.push(rel)
  }
  return dirs.sort((a, b) => a.localeCompare(b))
}

const PROPFIND_BODY =
  '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'

/**
 * Upload a file to the target's WebDAV share at `destPath` (relative to the
 * user's files root), creating any missing parent directories via MKCOL.
 * Throws on failure.
 */
export async function uploadToWebdav(
  host: string,
  username: string,
  password: string,
  destPath: string,
  body: Uint8Array,
): Promise<void> {
  const base = host.replace(/\/+$/, '')
  const filesRoot = `${base}/remote.php/dav/files/${encodeURIComponent(username)}`
  const authz = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')

  const segments = destPath.split('/').filter(Boolean)
  let cur = filesRoot
  for (const dir of segments.slice(0, -1)) {
    cur += '/' + encodeURIComponent(dir)
    const res = await fetch(cur, {
      method: 'MKCOL',
      headers: { Authorization: authz },
      signal: AbortSignal.timeout(10_000),
    })
    // 201 created or 405 already-exists are both fine.
    if (!res.ok && res.status !== 405) {
      throw new Error(`MKCOL ${res.status}`)
    }
  }

  const url = filesRoot + '/' + segments.map(encodeURIComponent).join('/')
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: authz },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
}

/** List the sub-directories of `path` on a target's Nextcloud WebDAV share. */
export async function browseWebdav(
  host: string,
  username: string,
  password: string,
  path: string,
): Promise<BrowseResult> {
  const base = host.replace(/\/+$/, '')
  const rel = path
    ? path.split('/').map(encodeURIComponent).join('/') + '/'
    : ''
  const url = `${base}/remote.php/dav/files/${encodeURIComponent(username)}/${rel}`
  const authz = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
  try {
    const res = await fetch(url, {
      method: 'PROPFIND',
      headers: { Authorization: authz, Depth: '1', 'Content-Type': 'application/xml' },
      body: PROPFIND_BODY,
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 404) {
      return { ok: false, path, dirs: [], message: 'Folder not found' }
    }
    if (!(res.status === 207 || res.ok)) {
      return { ok: false, path, dirs: [], message: `HTTP ${res.status}` }
    }
    return { ok: true, path, dirs: parseDirs(await res.text(), username, path) }
  } catch (e) {
    return { ok: false, path, dirs: [], message: (e as Error).message || 'Network error' }
  }
}

/**
 * Verify a Nextcloud WebDAV target with a lightweight PROPFIND (Depth 0) against
 * the user's files endpoint. 207 Multi-Status (or any 2xx) means the host is
 * reachable and the credentials are accepted.
 */
export async function testWebdav(
  host: string,
  username: string,
  password: string,
): Promise<TestResult> {
  const base = host.replace(/\/+$/, '')
  const url = `${base}/remote.php/dav/files/${encodeURIComponent(username)}/`
  const authz = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
  try {
    const res = await fetch(url, {
      method: 'PROPFIND',
      headers: { Authorization: authz, Depth: '0' },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 207 || res.ok) {
      return { ok: true, message: 'Connection successful' }
    }
    return {
      ok: false,
      message: `HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''}`,
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message || 'Network error' }
  }
}
