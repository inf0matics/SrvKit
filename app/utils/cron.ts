import { Cron } from 'croner'

/** True when `expr` is a valid, non-empty cron expression. */
export function cronIsValid(expr: string): boolean {
  if (!expr.trim()) return false
  try {
    new Cron(expr)
    return true
  } catch {
    return false
  }
}

/** Next fire time for `expr`, or null when empty/invalid. */
export function cronNextRun(expr: string): Date | null {
  if (!cronIsValid(expr)) return null
  return new Cron(expr).nextRun()
}

/**
 * Human "next run" label relative to now:
 *   `today 03:00` · `tomorrow 03:00` · `26.06 03:00`
 */
export function formatNextRun(d: Date): string {
  const time = d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const dayStart = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((dayStart(d) - dayStart(new Date())) / 86_400_000)
  if (diffDays === 0) return `today ${time}`
  if (diffDays === 1) return `tomorrow ${time}`
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm} ${time}`
}

/** Convenience: next-run label for a cron expression, or '' when none. */
export function cronNextLabel(expr: string): string {
  const next = cronNextRun(expr)
  return next ? formatNextRun(next) : ''
}
