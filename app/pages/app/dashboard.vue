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
type Level = 'warn' | 'crit'
interface Alarm {
  source: 'host' | 'docker' | 'peer'
  name: string
  detail: string
  level: Level
}
interface DockerService {
  name: string
  state: string
  status: 'ok' | 'warn' | 'crit' | 'pending' | 'off'
}
interface PeerRow {
  name: string
  status: 'ok' | 'crit'
  lastSeenAgoMs: number
}
interface Dashboard {
  serverName: string
  jobCount: number
  lastBackup: { name: string; at: string } | null
  incidents: Incident[]
  alarms: Alarm[]
  docker: { available: boolean; services: DockerService[] }
  peers: PeerRow[]
  outgoing: { domain: string; lastSentAt: number | null; ok: boolean | null } | null
}

const { data, refresh } = await useFetch<Dashboard>('/api/dashboard', {
  server: false,
  default: () => ({
    serverName: '',
    jobCount: 0,
    lastBackup: null,
    incidents: [],
    alarms: [],
    docker: { available: false, services: [] },
    peers: [],
    outgoing: null,
  }),
})

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(refresh, 8000)
})
onBeforeUnmount(() => clearInterval(timer))

function fmtLast(at: string): string {
  return new Date(at).toLocaleString()
}

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

function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ago`
}

function outgoingStatus(o: { lastSentAt: number | null; ok: boolean | null }): string {
  if (o.lastSentAt === null) return 'not sent yet'
  return o.ok ? `✓ last sent ${fmtAgo(Date.now() - o.lastSentAt)}` : '✗ last send failed'
}

const ALARM_ICON = { host: 'server', docker: 'docker', peer: 'heartbeat' } as const
const STATUS_LABEL: Record<string, string> = {
  ok: 'OK',
  warn: 'WARN',
  crit: 'CRIT',
  pending: 'pending',
}

function openIncident(i: Incident) {
  return navigateTo(`/app/backups/${i.targetId}/jobs/${i.jobId}/edit`)
}
</script>

<template>
  <div class="page" data-testid="dashboard">
    <h1>Dashboard</h1>

    <div class="metrics">
      <div class="metric" data-testid="metric-server">
        <span class="metric-label">Server</span>
        <span class="metric-value">{{ data.serverName || '—' }}</span>
      </div>
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

    <!-- Active alarms (host / docker / peer) -->
    <section v-if="data.alarms.length" class="card" data-testid="alarms">
      <h2 class="card-head danger"><AppIcon name="alert-triangle" /> Active alarms</h2>
      <div v-for="(a, i) in data.alarms" :key="i" class="row" :data-testid="`alarm-${a.source}`">
        <AppIcon :name="ALARM_ICON[a.source]" class="row-icon" />
        <span class="row-name">{{ a.name }}</span>
        <span class="row-detail tsp-muted">{{ a.detail }}</span>
        <span class="badge" :class="`st-${a.level}`">{{ STATUS_LABEL[a.level] }}</span>
      </div>
    </section>

    <!-- Open backup incidents (clickable → job) -->
    <section v-if="data.incidents.length" class="card" data-testid="incidents">
      <h2 class="card-head danger"><AppIcon name="alert-triangle" /> Open incidents</h2>
      <button
        v-for="i in data.incidents"
        :key="i.jobId"
        class="row incident-row"
        data-testid="incident-row"
        @click="openIncident(i)"
      >
        <span class="row-name">{{ i.name }}</span>
        <span class="row-detail tsp-muted">{{ i.targetName }}</span>
        <span class="row-since tsp-muted">{{ fmtSince(i.since) }}</span>
      </button>
    </section>

    <section
      v-if="!data.incidents.length && !data.alarms.length"
      class="card all-clear"
      data-testid="all-clear"
    >
      <AppIcon name="circle-check" /> All systems OK
    </section>

    <div class="grid">
      <!-- Monitored Docker services -->
      <section class="card" data-testid="docker-services">
        <h2 class="card-head"><AppIcon name="docker" /> Docker services</h2>
        <p v-if="!data.docker.available" class="empty">Docker socket not mounted.</p>
        <p v-else-if="!data.docker.services.length" class="empty">No containers monitored.</p>
        <div v-for="s in data.docker.services" v-else :key="s.name" class="row">
          <span class="row-name">{{ s.name }}</span>
          <span class="row-detail tsp-muted">{{ s.state }}</span>
          <span
            v-if="s.status !== 'off'"
            class="badge"
            :class="`st-${s.status}`"
          >{{ STATUS_LABEL[s.status] }}</span>
        </div>
      </section>

      <!-- Incoming peers -->
      <section class="card" data-testid="peers-incoming">
        <h2 class="card-head"><AppIcon name="heartbeat" /> Monitored peers</h2>
        <p v-if="!data.peers.length" class="empty">No peers registered.</p>
        <div v-for="p in data.peers" v-else :key="p.name" class="row">
          <span class="row-name">{{ p.name }}</span>
          <span class="row-detail tsp-muted">last seen {{ fmtAgo(p.lastSeenAgoMs) }}</span>
          <span class="badge" :class="`st-${p.status}`">{{ STATUS_LABEL[p.status] }}</span>
        </div>
      </section>

      <!-- Outgoing heartbeat -->
      <section class="card" data-testid="peers-outgoing">
        <h2 class="card-head"><AppIcon name="heartbeat" /> Outgoing heartbeat</h2>
        <p v-if="!data.outgoing" class="empty">Not configured.</p>
        <template v-else>
          <div class="row">
            <span class="row-name">{{ data.outgoing.domain }}</span>
          </div>
          <p class="out-status tsp-muted">{{ outgoingStatus(data.outgoing) }}</p>
        </template>
      </section>
    </div>
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
  overflow: hidden;
  text-overflow: ellipsis;
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
  padding: 16px 20px;
  margin-bottom: 16px;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--tsp-text-muted);
}

.card-head.danger {
  color: var(--tsp-danger);
  font-size: 1.05rem;
  text-transform: none;
  letter-spacing: 0;
  margin-bottom: 12px;
}

.card-head .app-icon {
  width: 18px;
  height: 18px;
}

.card-head.danger .app-icon {
  width: 20px;
  height: 20px;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  border-top: 1px solid var(--tsp-border);
  padding: 9px 2px;
}

.row:first-of-type {
  border-top: none;
}

.incident-row {
  background: none;
  border-left: none;
  border-right: none;
  border-bottom: none;
  cursor: pointer;
  font: inherit;
  color: inherit;
}

.incident-row:hover {
  background: var(--tsp-bg);
}

.row-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--tsp-text-muted);
}

.row-name {
  font-weight: 600;
  min-width: 0;
}

.row-detail {
  flex: 1;
  min-width: 0;
  font-size: 0.85rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-since {
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.badge {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
}

.st-ok {
  background: rgba(63, 185, 80, 0.15);
  color: var(--tsp-success, #3fb950);
}

.st-warn,
.st-pending {
  background: rgba(217, 165, 20, 0.18);
  color: var(--tsp-warn, #d9a514);
}

.st-crit {
  background: rgba(255, 99, 71, 0.18);
  color: var(--tsp-danger);
}

.empty {
  color: var(--tsp-text-muted);
  font-size: 0.9rem;
  margin: 4px 0;
}

.out-status {
  margin: 8px 2px 0;
  font-size: 0.85rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  align-items: start;
}

.grid .card {
  margin-bottom: 0;
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
