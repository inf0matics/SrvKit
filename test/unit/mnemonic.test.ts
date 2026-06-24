import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateMnemonic } from 'bip39'
import { generateSuggestion } from '../../lib/mnemonic.ts'

test('generates a valid 12-word BIP39 mnemonic', () => {
  const m = generateSuggestion()
  assert.equal(m.split(' ').length, 12)
  assert.ok(validateMnemonic(m))
})

test('each call produces a fresh suggestion', () => {
  assert.notEqual(generateSuggestion(), generateSuggestion())
})
