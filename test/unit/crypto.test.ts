import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { encrypt, decrypt } from '../../lib/crypto.ts'

beforeEach(() => {
  process.env.ENCRYPTION_KEY = 'unit-test-encryption-key'
})

// Reproduces the pre-v2 on-disk format: single-pass SHA-256 key, 3-part blob.
function legacyEncrypt(plain: string, secret: string): string {
  const k = createHash('sha256').update(secret, 'utf8').digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', k, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64')).join(':')
}

test('round-trips a secret', () => {
  const secret = 'hunter2 / nextcloud pw'
  assert.equal(decrypt(encrypt(secret)), secret)
})

test('ciphertext is non-deterministic (random IV)', () => {
  assert.notEqual(encrypt('same'), encrypt('same'))
})

test('serialized form is v2:iv:tag:ciphertext (HKDF)', () => {
  const parts = encrypt('x').split(':')
  assert.equal(parts.length, 4)
  assert.equal(parts[0], 'v2')
  for (const p of parts.slice(1)) assert.match(p, /^[A-Za-z0-9+/]+=*$/)
})

test('decrypts a legacy (pre-v2) blob with the old key — no re-encryption', () => {
  const blob = legacyEncrypt('old-secret', process.env.ENCRYPTION_KEY!)
  assert.equal(blob.split(':').length, 3) // legacy 3-part form
  assert.equal(decrypt(blob), 'old-secret')
})

test('tampering with the ciphertext is detected', () => {
  const blob = encrypt('secret')
  const [v, iv, tag, ct] = blob.split(':')
  // Flip a byte in the ciphertext.
  const buf = Buffer.from(ct!, 'base64')
  buf[0] ^= 0xff
  const tampered = [v, iv, tag, buf.toString('base64')].join(':')
  assert.throws(() => decrypt(tampered))
})

test('decrypting with a different key fails (auth tag mismatch)', () => {
  const blob = encrypt('secret')
  process.env.ENCRYPTION_KEY = 'a-totally-different-key'
  assert.throws(() => decrypt(blob))
})

test('throws when ENCRYPTION_KEY is missing', () => {
  delete process.env.ENCRYPTION_KEY
  assert.throws(() => encrypt('x'), /ENCRYPTION_KEY/)
})

test('rejects malformed ciphertext', () => {
  assert.throws(() => decrypt('not-a-valid-blob'), /Malformed/)
})
