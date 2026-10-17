import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apiErrorMessage, apiErrorField } from '../../app/utils/apiError.ts'

/**
 * h3's `sendError` serialises a rejection as `{ statusCode, statusMessage,
 * stack, data }` and ALSO puts the message in the HTTP reason phrase. ofetch
 * exposes that reason phrase as `err.statusMessage` — which HTTP/2 does not
 * carry, so behind Traefik it is always empty and only the body is left.
 * The helper therefore has to read the body first.
 */
const fallback = 'Could not save job'

test('reads the message from the JSON body (HTTP/2: no reason phrase)', () => {
  const err = {
    statusCode: 400,
    statusMessage: '', // response.statusText — empty over HTTP/2
    data: { statusCode: 400, statusMessage: 'Database user is required.', data: undefined },
  }
  assert.equal(apiErrorMessage(err, fallback), 'Database user is required.')
})

test('still works when only the reason phrase is there (HTTP/1.1, no body)', () => {
  const err = { statusCode: 400, statusMessage: 'Select a container.' }
  assert.equal(apiErrorMessage(err, fallback), 'Select a container.')
})

test('the body wins over the reason phrase when both are present', () => {
  const err = {
    statusMessage: 'Select a container.',
    data: { statusMessage: 'Database name is required.' },
  }
  assert.equal(apiErrorMessage(err, fallback), 'Database name is required.')
})

test('falls back when the error carries no message at all', () => {
  assert.equal(apiErrorMessage(new TypeError('network down'), fallback), fallback)
  assert.equal(apiErrorMessage(null, fallback), fallback)
  assert.equal(apiErrorMessage({ data: {} }, fallback), fallback)
  // A proxy that answers HTML, not the h3 body: no message to show.
  assert.equal(apiErrorMessage({ data: '<html>502</html>' }, fallback), fallback)
})

/**
 * Nitro's own error handler answers every unhandled failure with a body whose
 * statusMessage is the fixed placeholder "Server Error" (and no `data`). Taking
 * that as the message would replace each screen's own wording with the least
 * useful string in the system.
 */
test('Nitro\'s generic placeholder is not a message', () => {
  const unhandled = {
    statusCode: 500,
    statusMessage: '',
    data: { error: true, statusCode: 500, statusMessage: 'Server Error' },
  }
  assert.equal(apiErrorMessage(unhandled, fallback), fallback)
  // An API that authors its own 5xx wording still gets to say it.
  const authored = { data: { statusCode: 502, statusMessage: 'The backup target is unreachable.' } }
  assert.equal(apiErrorMessage(authored, fallback), 'The backup target is unreachable.')
})

test('picks up the offending field so the form can mark it', () => {
  const err = { data: { statusMessage: 'Select a container.', data: { field: 'container' } } }
  assert.equal(apiErrorField(err), 'container')
  assert.equal(apiErrorField({ data: { statusMessage: 'unknown target' } }), '')
  assert.equal(apiErrorField(new Error('boom')), '')
  // Only a string field name is usable as a form key.
  assert.equal(apiErrorField({ data: { data: { field: 42 } } }), '')
})
