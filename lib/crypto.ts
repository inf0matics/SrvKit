import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'node:crypto'

/**
 * Symmetric encryption for secrets stored at rest (e.g. backup-target
 * passwords). AES-256-GCM gives confidentiality plus an auth tag, so any
 * tampering with the ciphertext makes decryption fail rather than returning
 * garbage. The 256-bit key is derived from the ENCRYPTION_KEY env var.
 *
 * Serialized form:
 *   v2 (current): "v2:<iv>:<authTag>:<ciphertext>" — key via HKDF-SHA256
 *   legacy:       "<iv>:<authTag>:<ciphertext>"    — key via raw SHA-256
 *
 * New values are always written v2; legacy blobs still decrypt with the old
 * key, so the change needs no re-encryption migration — secrets migrate to v2
 * the next time they're saved.
 */

function secret(): string {
  const s = process.env.ENCRYPTION_KEY
  if (!s) throw new Error('ENCRYPTION_KEY is not set')
  return s
}

/** Current key derivation: HKDF-SHA256 (salted KDF, domain-separated by info). */
function hkdfKey(): Buffer {
  return Buffer.from(hkdfSync('sha256', secret(), '', 'srvkit-enc-v1', 32))
}

/** Legacy key derivation: single-pass SHA-256 (read-only, for old ciphertext). */
function legacyKey(): Buffer {
  return createHash('sha256').update(secret(), 'utf8').digest()
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', hkdfKey(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v2', ...[iv, tag, ct].map((b) => b.toString('base64'))].join(':')
}

export function decrypt(blob: string): string {
  const parts = blob.split(':')
  let k: Buffer
  let ivB64: string | undefined
  let tagB64: string | undefined
  let ctB64: string | undefined

  if (parts[0] === 'v2' && parts.length === 4) {
    ;[, ivB64, tagB64, ctB64] = parts
    k = hkdfKey()
  } else if (parts.length === 3) {
    ;[ivB64, tagB64, ctB64] = parts
    k = legacyKey()
  } else {
    throw new Error('Malformed ciphertext')
  }
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('Malformed ciphertext')
  }

  const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
