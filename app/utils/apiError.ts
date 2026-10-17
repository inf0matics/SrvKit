/**
 * The message out of a failed `$fetch`, in the terms the API phrased it.
 *
 * `createError({ statusMessage })` ends up in two places: h3's JSON body
 * (`{ statusCode, statusMessage, stack, data }`) and the HTTP reason phrase.
 * ofetch surfaces the reason phrase as `err.statusMessage` — but HTTP/2 has no
 * reason phrase, so behind Traefik that property is always `''` and reading it
 * leaves every rejection showing nothing but the caller's fallback. The body is
 * the only copy that survives both transports, so it is read first.
 */
interface ApiError {
  statusMessage?: string
  data?: { statusMessage?: string; data?: { field?: unknown } }
}

const asApiError = (e: unknown): ApiError =>
  e && typeof e === 'object' ? (e as ApiError) : {}

export function apiErrorMessage(e: unknown, fallback: string): string {
  const err = asApiError(e)
  const body = err.data && typeof err.data === 'object' ? err.data : undefined
  return body?.statusMessage || err.statusMessage || fallback
}

/**
 * The form field an API rejection belongs to, from `createError`'s `data`, or
 * `''` when the API did not name one. Lets a server-side refusal land on the
 * input that caused it instead of only in the summary line.
 */
export function apiErrorField(e: unknown): string {
  const field = asApiError(e).data?.data?.field
  return typeof field === 'string' ? field : ''
}
