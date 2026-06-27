import type { MaybeRefOrGetter } from 'vue'

/**
 * Shared server name (set via Settings → General). Fetched once into shared
 * state; the Settings page updates it on save so titles refresh live.
 */
export function useServerName() {
  const serverName = useState<string>('server-name', () => '')

  async function refresh() {
    try {
      const { serverName: sn } = await $fetch<{ serverName: string }>(
        '/api/settings/general',
      )
      serverName.value = sn
    } catch {
      // Unauthenticated / endpoint unavailable — leave the current value.
    }
  }

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
