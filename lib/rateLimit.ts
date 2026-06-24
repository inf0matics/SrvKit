export interface RateLimitResult {
  allowed: boolean
  /** Seconds the caller should wait before retrying (0 when allowed). */
  retryAfter: number
}

/**
 * Tiny in-memory sliding-window rate limiter, keyed by an arbitrary string
 * (we key on client IP). Single-container deployment, so an in-process map is
 * sufficient — no shared store needed. `now` is injected for deterministic
 * tests; callers pass `Date.now()`.
 */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>()

  return {
    check(key: string, now: number = Date.now()): RateLimitResult {
      const cutoff = now - windowMs
      const recent = (hits.get(key) ?? []).filter((t) => t > cutoff)

      if (recent.length >= limit) {
        hits.set(key, recent)
        const oldest = recent[0] ?? now
        const retryAfter = Math.ceil((oldest + windowMs - now) / 1000)
        return { allowed: false, retryAfter: Math.max(retryAfter, 1) }
      }

      recent.push(now)
      hits.set(key, recent)
      return { allowed: true, retryAfter: 0 }
    },
  }
}
