<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'shell' })
usePageTitle('Dashboard')

interface Incident {
  jobId: string
  targetId: string
  name: string
  type: string
  targetName: string
  since: string | null
}
interface Dashboard {
  jobCount: number
  lastBackup: { name: string; at: string } | null
  incidents: Incident[]
}

const { data, refresh } = await useFetch<Dashboard>('/api/dashboard', {
  server: false,
  default: () => ({ jobCount: 0, lastBackup: null, incidents: [] }),
})

// Live: incidents open/close as jobs run.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(refresh, 5000)
})
onBeforeUnmount(() => clearInterval(timer))

function fmtLast(at: string): string {
  return new Date(at).toLocaleString()
}

// "since" relative to today: today → HH:MM, yesterday → "yesterday HH:MM",
// otherwise a short date + time.
function fmtSince(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const now = new Date()
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((day(now) - day(d)) / 86_400_000)
  if (diffDays === 0) return `since ${time}`
  if (diffDays === 1) return `since yesterday ${time}`
  return `since ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

function openIncident(i: Incident) {
  return navigateTo(`/app/backups/${i.targetId}/jobs/${i.jobId}/edit`)
}
</script>

<template>
  <div class="page" data-testid="dashboard">
    <h1>Dashboard</h1>

    <div class="metrics">
      <div class="metric" data-testid="metric-jobs">
        <span class="metric-label">Backup jobs</span>
        <span class="metric-value">{{ data.jobCount }}</span>
      </div>
      <div class="metric" data-testid="metric-last-backup">
        <span class="metric-label">Last backup</span>
        <template v-if="data.lastBackup">
          <span class="metric-value">{{ fmtLast(data.lastBackup.at) }}</span>
          <span class="metric-sub tsp-muted">{{ data.lastBackup.name }}</span>
        </template>
        <span v-else class="metric-value muted-dash">—</span>
      </div>
    </div>

    <section v-if="data.incidents.length" class="card" data-testid="incidents">
      <h2 class="incidents-head">
        <AppIcon name="alert-triangle" /> Open incidents
      </h2>
      <button
        v-for="i in data.incidents"
        :key="i.jobId"
        class="incident-row"
        data-testid="incident-row"
        @click="openIncident(i)"
      >
        <span class="inc-name">{{ i.name }}</span>
        <span class="inc-target tsp-muted">{{ i.targetName }}</span>
        <span class="inc-since tsp-muted">{{ fmtSince(i.since) }}</span>
      </button>
    </section>

    <section v-else class="card all-clear" data-testid="all-clear">
      <AppIcon name="circle-check" /> All systems OK
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 896px;
  margin: 0 auto;
  padding: 40px 24px 64px;
}

.page h1 {
  margin: 0 0 18px;
  font-size: 1.6rem;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}

.metric {
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius);
  background: var(--tsp-surface);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--tsp-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.metric-value {
  font-size: 1.4rem;
  font-weight: 700;
}

.metric-sub {
  font-size: 0.85rem;
}

.muted-dash {
  color: var(--tsp-text-muted);
}

.card {
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius);
  background: var(--tsp-surface);
  padding: 18px 20px;
}

.incidents-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 1.1rem;
  color: var(--tsp-danger);
}

.incidents-head .app-icon {
  width: 20px;
  height: 20px;
}

.incident-row {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-top: 1px solid var(--tsp-border);
  padding: 12px 4px;
  cursor: pointer;
  font: inherit;
  color: inherit;
}

.incident-row:first-of-type {
  border-top: none;
}

.incident-row:hover {
  background: var(--tsp-bg);
}

.inc-name {
  font-weight: 600;
  flex: 1;
  min-width: 0;
}

.inc-target {
  font-size: 0.88rem;
}

.inc-since {
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.all-clear {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--tsp-success, #3fb950);
  font-weight: 600;
}

.all-clear .app-icon {
  width: 20px;
  height: 20px;
}
</style>
