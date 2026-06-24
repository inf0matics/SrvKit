import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'

/**
 * Symmetric encryption for secrets stored at rest (e.g. backup-target
 * passwords). AES-256-GCM gives confidentiality plus an auth tag, so any
 * tampering with the ciphertext makes decryption fail rather than returning
 * garbage. The 256-bit key is derived from the ENCRYPTION_KEY env var.
 *
 * Serialized form: "<iv>:<authTag>:<ciphertext>", each part base64.
 */

function key(): Buffer {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) {
    throw new Error('ENCRYPTION_KEY is not set')
  }
  // SHA-256 maps an arbitrary-length secret to a fixed 32-byte AES key.
  return createHash('sha256').update(secret, 'utf8').digest()
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, ct].map((b) => b.toString('base64')).join(':')
}

export function decrypt(blob: string): string {
  const [ivB64, tagB64, ctB64] = blob.split(':')
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('Malformed ciphertext')
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key(),
    Buffer.from(ivB64, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
