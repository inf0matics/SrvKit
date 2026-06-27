import { Cron } from 'croner'

/**
 * The timezone the scheduler interprets cron expressions in (croner uses the
 * process/system local time by default). Exposed so the UI formats next-run
 * times in the same zone the job actually fires in. Set TZ to change it.
 */
export function serverTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** True when `expr` is a valid (non-empty) cron expression. */
export function isValidCron(expr: string): boolean {
  if (!expr.trim()) return false
  try {
    new Cron(expr)
    return true
  } catch {
    return false
  }
}

/** Next fire time as an ISO string, or null when the expression is invalid. */
export function nextRun(expr: string): string | null {
  if (!isValidCron(expr)) return null
  const n = new Cron(expr).nextRun()
  return n ? n.toISOString() : null
}
