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

/**
 * Next fire time for `expr`, interpreted in `tz` (the server's timezone) so the
 * preview matches when the job actually runs. Null when empty/invalid.
 */
export function cronNextRun(expr: string, tz?: string): Date | null {
  if (!cronIsValid(expr)) return null
  return (tz ? new Cron(expr, { timezone: tz }) : new Cron(expr)).nextRun()
}

function zoneOpts(tz?: string): { timeZone?: string } {
  return tz ? { timeZone: tz } : {}
}

// YYYY-MM-DD calendar key for `d` in the given timezone.
function dayKey(d: Date, tz?: string): string {
  return d.toLocaleDateString('en-CA', zoneOpts(tz))
}

/**
 * Human "next run" label in timezone `tz`:
 *   `today 19:00` · `tomorrow 19:00` · `28.06.2026 19:00`
 */
export function formatNextRun(d: Date, tz?: string): string {
  const time = d.toLocaleTimeString('en-GB', {
    ...zoneOpts(tz),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const key = dayKey(d, tz)
  if (key === dayKey(new Date(), tz)) return `today ${time}`
  if (key === dayKey(new Date(Date.now() + 86_400_000), tz)) return `tomorrow ${time}`
  const date = d
    .toLocaleDateString('en-GB', {
      ...zoneOpts(tz),
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
    .replace(/\//g, '.') // 28/06/2026 → 28.06.2026
  return `${date} ${time}`
}

/** Convenience: next-run label for a cron expression, or '' when none. */
export function cronNextLabel(expr: string, tz?: string): string {
  const next = cronNextRun(expr, tz)
  return next ? formatNextRun(next, tz) : ''
}

/**
 * Human "last run" label in timezone `tz`:
 *   `today 21:00` · `yesterday 21:00` · `28.06 21:00`
 */
export function formatLastRun(d: Date, tz?: string): string {
  const time = d.toLocaleTimeString('en-GB', {
    ...zoneOpts(tz),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const key = dayKey(d, tz)
  if (key === dayKey(new Date(), tz)) return `today ${time}`
  if (key === dayKey(new Date(Date.now() - 86_400_000), tz)) return `yesterday ${time}`
  const date = d
    .toLocaleDateString('en-GB', { ...zoneOpts(tz), day: '2-digit', month: '2-digit' })
    .replace(/\//g, '.') // 28/06 → 28.06
  return `${date} ${time}`
}
