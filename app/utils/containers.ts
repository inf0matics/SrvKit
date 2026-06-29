// Image keywords a DB job type matches by default in the container dropdown.
const DB_KEYWORDS: Record<string, string[]> = {
  postgres: ['postgres'],
  mysql: ['mysql', 'mariadb'],
}

/**
 * Base image name: drop the registry/path prefix and the tag/digest, lowercased.
 *   docker.io/library/postgres:16        → postgres
 *   my-registry.com/postgres-custom:tag  → postgres-custom
 *   mysql:8                              → mysql
 */
export function imageBaseName(image: string): string {
  const lastSegment = image.split('/').pop() ?? image
  return (lastSegment.split('@')[0] ?? '').split(':')[0]!.toLowerCase()
}

/** Whether a container image matches the DB job type's default filter. */
export function matchesDbImage(image: string, type: string): boolean {
  const keywords = DB_KEYWORDS[type]
  if (!keywords) return true // unknown type → no filtering
  const base = imageBaseName(image)
  return keywords.some((k) => base.includes(k))
}

/** Display label for the type's filtered empty state ("PostgreSQL" / "MySQL"). */
export function dbTypeLabel(type: string): string {
  return type === 'mysql' ? 'MySQL' : 'PostgreSQL'
}
