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
  excludes: string[]
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

/* ---- inline delete confirmation ---- */
const confirmingDelete = ref<string | null>(null)

async function confirmDelete(job: Job) {
  await $fetch(`/api/backups/jobs/${job.id}`, { method: 'DELETE' })
  confirmingDelete.value = null
  await refreshJobs()
}

/** Full Nextcloud destination path: {host} / {root} / {subdir} / {file}.tar.gz */
function destPath(job: Job): string {
  const host = props.target.host.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const segs = [host, props.target.rootDir, job.subdirectory].filter(Boolean)
  return [...segs, job.name + '.tar.gz'].join(' / ')
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
              {{ job.type === 'files' ? 'Files' : job.type }}
            </span>
          </div>
          <div class="job-meta tsp-muted" data-testid="job-dest">{{ destPath(job) }}</div>
        </div>
        <span class="job-status tsp-muted">Never run</span>
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
  flex-shrink: 0;
}

.no-jobs {
  margin: 0 0 10px;
  font-size: 0.9rem;
}

.add-job {
  margin-top: 12px;
}
</style>
