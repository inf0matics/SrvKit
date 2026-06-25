export interface TargetSummary {
  id: string
  name: string
  host: string
  username: string
  rootDir: string
  createdAt: string
}

/**
 * Shared backup-targets state so the sidebar (shell layout) and the Backups
 * pages stay in sync — adding or deleting a target on a page updates the
 * sidebar sub-items without a reload. Fetch is client-only so the session
 * cookie is sent (the API is guarded).
 */
export function useTargets() {
  const targets = useState<TargetSummary[]>('targets', () => [])

  async function refresh() {
    targets.value = await $fetch<TargetSummary[]>('/api/backups/targets')
  }

  return { targets, refresh }
}
