export interface MutedJob {
  id: string
  name: string
  type: string
  targetName: string
}

interface MutedResponse {
  count: number
  jobs: MutedJob[]
}

/**
 * Shared muted-jobs state for the topbar badge (count) and the Settings → Alerts
 * list. Client-only fetch so the session cookie is sent; the topbar polls so the
 * badge reflects mutes made on other pages.
 */
export function useMutedJobs() {
  const jobs = useState<MutedJob[]>('muted-jobs', () => [])
  const count = computed(() => jobs.value.length)

  async function refresh() {
    const res = await $fetch<MutedResponse>('/api/alerts/muted')
    jobs.value = res.jobs
  }

  return { jobs, count, refresh }
}
