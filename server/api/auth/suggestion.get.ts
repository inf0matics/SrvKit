import { store } from '../../utils/srvkit.ts'
import { generateSuggestion } from '../../../lib/mnemonic.ts'

// Setup-only: a fresh BIP39 suggestion per call. 404 once a password exists,
// so the endpoint leaks nothing after initialization.
export default defineEventHandler(() => {
  if (store().isInitialized()) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  return { mnemonic: generateSuggestion() }
})
