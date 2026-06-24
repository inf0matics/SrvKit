import { encrypt, decrypt } from '../../lib/crypto.ts'

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
