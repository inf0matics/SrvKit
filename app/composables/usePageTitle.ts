import type { MaybeRefOrGetter } from 'vue'

/**
 * Shared general server info — name (set via Settings) and timezone (the zone
 * cron schedules run in). Fetched once into shared state; the Settings page
 * updates the name on save so titles refresh live.
 */
export function useServerInfo() {
  const serverName = useState<string>('server-name', () => '')
  const timezone = useState<string>('server-tz', () => '')

  async function refresh() {
    try {
      const { serverName: sn, timezone: tz } = await $fetch<{
        serverName: string
        timezone: string
      }>('/api/settings/general')
      serverName.value = sn
      timezone.value = tz
    } catch {
      // Unauthenticated / endpoint unavailable — leave the current values.
    }
  }

  return { serverName, timezone, refresh }
}

/** Server name + refresh (used by the page-title prefix). */
export function useServerName() {
  const { serverName, refresh } = useServerInfo()
  return { serverName, refresh }
}

/**
 * Set the browser tab title for a page:
 *   `SrvKit | {server name} | {page}`  (when a server name is set)
 *   `SrvKit | {page}`                  (otherwise)
 * Pass a getter for dynamic names (target/job) so the title updates on load.
 */
export function usePageTitle(name: MaybeRefOrGetter<string>) {
  const { serverName } = useServerName()
  const title = computed(() => {
    const page = toValue(name)
    return serverName.value
      ? `SrvKit | ${serverName.value} | ${page}`
      : `SrvKit | ${page}`
  })
  useHead({ title })
}
