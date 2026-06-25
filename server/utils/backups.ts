import { join } from 'node:path'
import { createError } from 'h3'
import { encrypt, decrypt } from '../../lib/crypto.ts'
import { listSources, buildTree, type TreeNode } from '../../lib/sources.ts'
import type { JobInput } from '../../lib/store.ts'
import { store } from './srvkit.ts'

/** Base directory holding the mounted backup sources. */
export function sourcesDir(): string {
  return process.env.BACKUP_SOURCES_DIR || '/backups'
}

/** Available source names (immediate sub-directories of the base). */
export function getSources(): string[] {
  return listSources(sourcesDir())
}

/** File tree for a source, or null if the name isn't a known source. */
export function getSourceTree(name: string): TreeNode[] | null {
  if (!getSources().includes(name)) return null
  return buildTree(join(sourcesDir(), name))
}

/** Validate + normalize a job request body (shared by create and update). */
export function parseJobInput(body: Record<string, unknown> | null): JobInput {
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

  return { targetId, name, type, sourcePath, excludes, output, subdirectory }
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
