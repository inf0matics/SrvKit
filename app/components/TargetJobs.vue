<script setup lang="ts">
import type { TargetSummary } from '~/composables/useTargets'

interface Job {
  id: string
  targetId: string
  name: string
  type: string
  sourcePath: string
  output: string
  subdirectory: string
  includes: string[]
  dateSuffix: boolean
  active: boolean
  muted: boolean
  lastRunAt: string | null
  lastStatus: 'success' | 'failed' | null
  lastError: string | null
  running: boolean
  state: 'never' | 'debouncing' | 'running' | 'success' | 'failed'
  remainingMs: number
}

const props = defineProps<{ target: TargetSummary }>()

const { data: jobs, refresh: refreshJobs } = await useFetch<Job[]>(
  () => `/api/backups/jobs?targetId=${props.target.id}`,
  { server: false, default: () => [] },
)

/* ---- create modal + edit navigation ---- */
const addOpen = ref(false)

function editJob(job: Job) {
  return navigateTo(`/app/backups/${props.target.id}/jobs/${job.id}/edit`)
}

/* ---- run now ---- */
const localRunning = ref<Record<string, boolean>>({})
// A run is "active" (spinner) when the server reports running or we just clicked.
const runActive = (job: Job) => job.state === 'running' || !!localRunning.value[job.id]
// Run Now is disabled while debouncing or running.
const isBusy = (job: Job) => runActive(job) || job.state === 'debouncing'

async function runNow(job: Job) {
  localRunning.value[job.id] = true
  try {
    await $fetch(`/api/backups/jobs/${job.id}/run`, { method: 'POST' })
    await refreshJobs()
  } finally {
    localRunning.value[job.id] = false
  }
}

/* ---- mute / unmute (suppress alerts without disabling the job) ---- */
const { refresh: refreshMuted } = useMutedJobs()
async function toggleMute(job: Job) {
  await $fetch(`/api/backups/jobs/${job.id}/mute`, {
    method: 'POST',
    body: { muted: !job.muted },
  })
  await Promise.all([refreshJobs(), refreshMuted()])
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '')

/* ---- debounce countdown (client-side, seeded from server remainingMs) ---- */
const nowMs = ref(Date.now())
const deadlines = ref<Record<string, number>>({})

watch(
  jobs,
  (list) => {
    const next: Record<string, number> = {}
    for (const j of list ?? []) {
      if (j.state === 'debouncing') next[j.id] = Date.now() + j.remainingMs
    }
    deadlines.value = next
  },
  { immediate: true },
)

function countdownSeconds(job: Job): number {
  const dl = deadlines.value[job.id]
  const ms = dl ? dl - nowMs.value : job.remainingMs
  return Math.max(0, Math.ceil(ms / 1000))
}

/* ---- timers: poll status every 2s, tick the countdown every 1s ---- */
let pollTimer: ReturnType<typeof setInterval> | undefined
let tickTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  pollTimer = setInterval(() => void refreshJobs(), 2000)
  tickTimer = setInterval(() => (nowMs.value = Date.now()), 1000)
})
onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (tickTimer) clearInterval(tickTimer)
})

/* ---- inline delete confirmation ---- */
const confirmingDelete = ref<string | null>(null)

async function confirmDelete(job: Job) {
  await $fetch(`/api/backups/jobs/${job.id}`, { method: 'DELETE' })
  confirmingDelete.value = null
  await refreshJobs()
}

const TYPE_LABELS: Record<string, string> = {
  sqlite: 'SQLite',
  postgres: 'PostgreSQL',
  files: 'Files',
}
const typeLabel = (job: Job) => TYPE_LABELS[job.type] ?? 'Files'

/** Full Nextcloud destination path: {host}/{root}/{subdir}/{name}[_date].tar.gz */
function destPath(job: Job): string {
  const host = props.target.host.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const date = new Date().toISOString().slice(0, 10)
  const file = job.name + (job.dateSuffix ? `_${date}` : '') + '.tar.gz'
  const segs = [host, props.target.rootDir, job.subdirectory].filter(Boolean)
  return [...segs, file].join('/')
}
</script>

<template>
  <div class="jobs">
    <div v-for="job in jobs" :key="job.id" class="job">
      <template v-if="confirmingDelete === job.id">
        <div class="job-info">
          <div class="job-name">{{ job.name }}</div>
          <div class="confirm tsp-muted">Delete this job?</div>
        </div>
        <button class="tsp-btn tsp-btn-sm" @click="confirmingDelete = null">Cancel</button>
        <button class="tsp-btn tsp-btn-sm tsp-btn-danger" @click="confirmDelete(job)">
          Delete
        </button>
      </template>
      <template v-else>
        <div class="job-info">
          <div class="job-head">
            <span class="job-name">{{ job.name }}</span>
            <span class="job-type-badge" data-testid="job-type">
              {{ typeLabel(job) }}
            </span>
          </div>
          <div class="job-meta tsp-muted" data-testid="job-dest">{{ destPath(job) }}</div>
        </div>
        <span class="job-status" data-testid="job-status">
          <span v-if="!job.active" class="tsp-muted">Not configured</span>
          <template v-else-if="runActive(job)">
            <span class="spinner" /> Running…
          </template>
          <span v-else-if="job.state === 'debouncing'" class="st-debounce">
            ⏳ {{ countdownSeconds(job) }}s
          </span>
          <span v-else-if="job.state === 'success'" class="tsp-muted">
            ✓ Last backup: {{ fmt(job.lastRunAt) }}
          </span>
          <span v-else-if="job.state === 'failed'" class="st-fail">
            ✗ Last backup: {{ fmt(job.lastRunAt) }}<template v-if="job.lastError"> — {{ job.lastError }}</template>
          </span>
          <span v-else class="tsp-muted">No backup yet</span>
        </span>
        <button
          class="tsp-btn tsp-btn-sm tsp-btn-icon"
          :class="{ muted: job.muted }"
          :aria-label="job.muted ? 'Unmute job' : 'Mute job'"
          :title="job.muted ? 'Alerts muted — click to unmute' : 'Mute alerts for this job'"
          @click="toggleMute(job)"
        >
          <AppIcon name="bell-off" />
        </button>
        <button
          class="tsp-btn tsp-btn-sm tsp-btn-icon"
          aria-label="Run job now"
          :disabled="!job.active || isBusy(job)"
          :title="!job.active ? 'Configure and save the job first' : ''"
          @click="runNow(job)"
        >
          <AppIcon name="play" />
        </button>
        <button
          class="tsp-btn tsp-btn-sm tsp-btn-icon"
          aria-label="Edit job"
          @click="editJob(job)"
        >
          <AppIcon name="edit" />
        </button>
        <button
          class="tsp-btn tsp-btn-sm tsp-btn-icon"
          aria-label="Delete job"
          @click="confirmingDelete = job.id"
        >
          <AppIcon name="trash" />
        </button>
      </template>
    </div>

    <p v-if="!jobs.length" class="tsp-muted no-jobs">No backup jobs yet.</p>

    <button class="tsp-btn tsp-btn-sm add-job" @click="addOpen = true">+ Add Job</button>

    <AddJobModal v-if="addOpen" :target="target" @close="addOpen = false" />
  </div>
</template>

<style scoped>
.jobs {
  margin-top: 4px;
}

.job {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--tsp-border);
}

.job-info {
  flex: 1;
  min-width: 0;
}

.job-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.job-name {
  font-weight: 700;
  font-size: 0.95rem;
}

/* Muted pill badge — TSP chip style. */
.job-type-badge {
  display: inline-block;
  padding: 1px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  background: var(--tsp-border);
  color: var(--tsp-text-muted);
}

.job-meta {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.confirm {
  font-size: 0.85rem;
}

.job-status {
  font-size: 0.85rem;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 22rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.st-fail {
  color: var(--tsp-danger);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.st-debounce {
  color: var(--tsp-primary);
  font-variant-numeric: tabular-nums;
}

/* Muted mute-button: orange to signal alerts are suppressed for this job. */
.tsp-btn-icon.muted {
  color: var(--tsp-primary);
  border-color: var(--tsp-primary);
}

.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--tsp-border);
  border-top-color: var(--tsp-primary);
  border-radius: 50%;
  display: inline-block;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.no-jobs {
  margin: 0 0 10px;
  font-size: 0.9rem;
}

.add-job {
  margin-top: 12px;
}
</style>
