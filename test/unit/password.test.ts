import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hashPassword,
  verifyPassword,
  isValidPassword,
} from '../../lib/password.ts'

test('hash verifies against the original password', () => {
  const hash = hashPassword('correct horse battery staple')
  assert.ok(verifyPassword('correct horse battery staple', hash))
  assert.ok(!verifyPassword('wrong password', hash))
})

test('hashes are salted (two hashes of same input differ)', () => {
  assert.notEqual(hashPassword('same'), hashPassword('same'))
})

test('uses bcrypt cost factor 12', () => {
  // bcrypt hash format: $2b$<cost>$...
  assert.match(hashPassword('x'), /^\$2[aby]\$12\$/)
})

test('full 12-word passphrase counts past bcrypt 72-byte truncation', () => {
  // Two long passphrases identical in their first 72 bytes but differing at
  // the end must NOT verify against each other (they would if not pre-hashed).
  const prefix = 'a'.repeat(72)
  const hash = hashPassword(prefix + 'TAIL-ONE')
  assert.ok(verifyPassword(prefix + 'TAIL-ONE', hash))
  assert.ok(!verifyPassword(prefix + 'TAIL-TWO', hash))
})

test('empty / blank passwords are rejected', () => {
  assert.ok(!isValidPassword(''))
  assert.ok(!isValidPassword('   '))
  assert.ok(!isValidPassword(undefined))
  assert.throws(() => hashPassword(''))
  assert.throws(() => hashPassword('   '))
})

test('verify is safe against null hash / non-string input', () => {
  assert.ok(!verifyPassword('x', null))
  assert.ok(!verifyPassword(undefined as unknown as string, '$2b$12$abc'))
})
