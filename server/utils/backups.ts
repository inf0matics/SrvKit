import { join, resolve, sep, isAbsolute, normalize } from 'node:path'
import { createError } from 'h3'
import { encrypt, decrypt } from '../../lib/crypto.ts'
import {
  listSources,
  listDbFiles,
  listChildren,
  buildTree,
  missingIncludes,
  type TreeNode,
  type ChildNode,
} from '../../lib/sources.ts'
import type { JobInput, JobRecord } from '../../lib/store.ts'
import { isSqliteFile, isWalDatabase } from '../../lib/sqlite-backup.ts'
import { isValidCron } from '../../lib/cron.ts'
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

/** Archive filename for a job, with optional _YYYY-MM-DD and _HH-MM-SS suffixes. */
export function archiveFilename(
  name: string,
  dateSuffix: boolean,
  timeSuffix = false,
  date = new Date(),
): string {
  const iso = date.toISOString()
  const datePart = dateSuffix ? `_${iso.slice(0, 10)}` : ''
  const timePart = timeSuffix ? `_${iso.slice(11, 19).replace(/:/g, '-')}` : ''
  return `${name}${datePart}${timePart}.tar.gz`
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

/** Of a Files job's `includes`, those that no longer exist under `sourcePath`. */
export function getMissingIncludes(sourcePath: string, includes: string[]): string[] {
  return missingIncludes(sourcesDir(), sourcePath, includes)
}

function baseJobFields(body: Record<string, unknown> | null) {
  const name = trimStr(body?.name)
  const targetId = trimStr(body?.targetId)
  const type = trimStr(body?.type) || 'files'
  if (!name || !targetId) {
    throw createError({ statusCode: 400, statusMessage: 'name and targetId are required' })
  }
  if (type !== 'files' && type !== 'sqlite' && type !== 'postgres' && type !== 'mysql') {
    throw createError({ statusCode: 400, statusMessage: 'unsupported job type' })
  }
  if (!store().getTarget(targetId)) {
    throw createError({ statusCode: 400, statusMessage: 'unknown target' })
  }
  return { name, targetId, type }
}

/** Empty PostgreSQL fields, shared by every non-postgres job. */
const emptyPgFields = { container: '', database: '', dbUser: '', dbPassword: '' }

/** Minimal create: just name + type. The job is created inactive, no source. */
export function parseNewJob(body: Record<string, unknown> | null): JobInput {
  const { name, targetId, type } = baseJobFields(body)
  return {
    targetId,
    name,
    type,
    sourcePath: '',
    includes: [],
    output: 'single',
    subdirectory: '',
    dateSuffix: false,
    timeSuffix: false,
    trigger: 'filewatcher',
    schedule: '',
    ...emptyPgFields,
  }
}

/** Strip the encrypted DB password from a job before returning it to the UI. */
export function publicJob(job: JobRecord): Omit<JobRecord, 'dbPassword'> & {
  hasDbPassword: boolean
} {
  const { dbPassword, ...rest } = job
  return { ...rest, hasDbPassword: !!dbPassword }
}

/** Full validation for saving (activating) a job from the edit page. */
export function parseJobInput(body: Record<string, unknown> | null): JobInput {
  const { name, targetId, type } = baseJobFields(body)
  const sourcePath = trimStr(body?.sourcePath)
  const output = trimStr(body?.output) || 'single'
  const subdirectory = normalizeRoot(body?.subdirectory)
  const dateSuffix = body?.dateSuffix === true
  const timeSuffix = body?.timeSuffix === true
  const includes = Array.isArray(body?.includes)
    ? (body.includes as unknown[])
        .filter((e): e is string => typeof e === 'string')
        .filter(isSafeInclude) // drop ../ escapes and absolute paths
    : []

  const pg = { ...emptyPgFields }
  let trigger = 'filewatcher'
  let schedule = ''

  if (type === 'postgres' || type === 'mysql') {
    pg.container = trimStr(body?.container)
    pg.database = trimStr(body?.database)
    pg.dbUser = trimStr(body?.dbUser)
    schedule = trimStr(body?.schedule)
    trigger = 'cron' // container DB dumps are always cron-triggered
    const password = typeof body?.dbPassword === 'string' ? body.dbPassword : ''
    if (!pg.container) {
      throw createError({ statusCode: 400, statusMessage: 'Select a container.' })
    }
    if (!pg.database) {
      throw createError({ statusCode: 400, statusMessage: 'Database name is required.' })
    }
    if (!pg.dbUser) {
      throw createError({ statusCode: 400, statusMessage: 'Database user is required.' })
    }
    if (!isValidCron(schedule)) {
      throw createError({ statusCode: 400, statusMessage: 'A valid cron schedule is required.' })
    }
    // Empty = "keep the stored password"; the PUT handler resolves it.
    pg.dbPassword = password ? encryptPassword(password) : ''
  } else if (type === 'sqlite') {
    const abs = sourcePath ? resolveSourcePath(sourcePath) : null
    if (!abs) {
      throw createError({ statusCode: 400, statusMessage: 'Select a source file.' })
    }
    if (!isSqliteFile(abs)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'The selected file is not a valid SQLite database.',
      })
    }
    // WAL-mode databases can only be cron-triggered (the filewatcher is unreliable).
    const wal = isWalDatabase(abs)
    trigger = wal || trimStr(body?.trigger) === 'cron' ? 'cron' : 'filewatcher'
    if (trigger === 'cron') {
      schedule = trimStr(body?.schedule)
      if (!isValidCron(schedule)) {
        throw createError({ statusCode: 400, statusMessage: 'A valid cron schedule is required.' })
      }
    }
  } else {
    if (!getSources().includes(sourcePath)) {
      throw createError({ statusCode: 400, statusMessage: 'Select a source directory.' })
    }
    if (includes.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Select at least one file to back up.',
      })
    }
  }

  return {
    targetId,
    name,
    type,
    sourcePath,
    includes,
    output,
    subdirectory,
    dateSuffix,
    timeSuffix,
    trigger,
    schedule,
    ...pg,
  }
}

export function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * A job `include` must stay inside the source dir — reject absolute paths and
 * any that normalize to an escape (`../…`), so a job can't archive host files
 * outside its configured source via tar's relative cwd.
 */
export function isSafeInclude(p: string): boolean {
  if (!p || isAbsolute(p)) return false
  const norm = normalize(p)
  return norm !== '..' && !norm.startsWith('../')
}

/** True for loopback / RFC-1918 / link-local literals — the SSRF-prone ranges. */
function isPrivateIp(ip: string): boolean {
  if (/^127\./.test(ip) || ip === '0.0.0.0') return true
  if (/^10\./.test(ip)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true
  if (/^192\.168\./.test(ip)) return true
  if (/^169\.254\./.test(ip)) return true // link-local incl. cloud metadata
  const v6 = ip.toLowerCase()
  if (v6 === '::1' || v6 === '::') return true
  if (/^f[cd][0-9a-f]{2}:/.test(v6)) return true // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(v6)) return true // fe80::/10 link-local
  if (/^::ffff:(127|10|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(v6)) return true
  return false
}

/**
 * A backup-target host must be an http(s) URL. By default we also reject
 * loopback / private / link-local addresses so an authenticated user can't
 * point the server at internal services or cloud metadata (SSRF). Set
 * ALLOW_PRIVATE_WEBDAV=1 to permit them (LAN / homelab Nextcloud, dev/e2e).
 */
export function isValidHost(host: string): boolean {
  let u: URL
  try {
    u = new URL(host)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (process.env.ALLOW_PRIVATE_WEBDAV === '1') return true
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '') // strip IPv6 brackets
  if (h === 'localhost' || h.endsWith('.localhost')) return false
  if (isPrivateIp(h)) return false
  return true
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
