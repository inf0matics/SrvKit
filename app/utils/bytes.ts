const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/**
 * Human-readable size for a raw content byte count. Whole bytes below 1 KB (a
 * dump measured in bytes is a broken dump — the exact number is the point),
 * one decimal above it. Null (a run recorded before byte counts existed)
 * renders as nothing rather than "0 B", which would read as a failure.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return ''
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return unit === 0 ? `${value} ${UNITS[0]}` : `${value.toFixed(1)} ${UNITS[unit]}`
}
