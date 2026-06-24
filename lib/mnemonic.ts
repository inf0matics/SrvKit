import { generateMnemonic } from 'bip39'

/**
 * Generate a fresh BIP39 suggestion: 12 English words / 128 bits of entropy —
 * enough security, still manageable to write down. Generated on demand and
 * never persisted until the user explicitly saves it.
 */
export function generateSuggestion(): string {
  return generateMnemonic(128)
}
