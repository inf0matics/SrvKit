export type BackupStatus = 'ok' | 'error'

/**
 * Shared aggregate backup status for the sidebar badge. `null` = no jobs (no
 * badge). Client-only fetch (the API is guarded).
 */
export function useBackupsStatus() {
  const status = useState<BackupStatus | null>('backups-status', () => null)

  async function refresh() {
    status.value = (await $fetch<{ status: BackupStatus | null }>('/api/backups/status')).status
  }

  return { status, refresh }
}
