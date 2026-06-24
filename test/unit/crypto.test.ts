import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { encrypt, decrypt } from '../../lib/crypto.ts'

beforeEach(() => {
  process.env.ENCRYPTION_KEY = 'unit-test-encryption-key'
})

test('round-trips a secret', () => {
  const secret = 'hunter2 / nextcloud pw'
  assert.equal(decrypt(encrypt(secret)), secret)
})

test('ciphertext is non-deterministic (random IV)', () => {
  assert.notEqual(encrypt('same'), encrypt('same'))
})

test('serialized form is iv:tag:ciphertext (3 base64 parts)', () => {
  const parts = encrypt('x').split(':')
  assert.equal(parts.length, 3)
  for (const p of parts) assert.match(p, /^[A-Za-z0-9+/]+=*$/)
})

test('tampering with the ciphertext is detected', () => {
  const blob = encrypt('secret')
  const [iv, tag, ct] = blob.split(':')
  // Flip a byte in the ciphertext.
  const buf = Buffer.from(ct, 'base64')
  buf[0] ^= 0xff
  const tampered = [iv, tag, buf.toString('base64')].join(':')
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
