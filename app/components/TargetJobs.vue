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

const props = defineProps<{ target: TargetSummary; targets: TargetSummary[] }>()

const { data: jobs, refresh: refreshJobs } = await useFetch<Job[]>(
  () => `/api/backups/jobs?targetId=${props.target.id}`,
  { server: false, default: () => [] },
)

/* ---- wizard (create / edit) ---- */
const wizardOpen = ref(false)
const editingJob = ref<Job | null>(null)

function openNew() {
  editingJob.value = null
  wizardOpen.value = true
}
function openEdit(job: Job) {
  editingJob.value = job
  wizardOpen.value = true
}
function closeWizard() {
  wizardOpen.value = false
  editingJob.value = null
}
async function onSaved() {
  closeWizard()
  await refreshJobs()
}

/* ---- inline delete confirmation ---- */
const confirmingDelete = ref<string | null>(null)

async function confirmDelete(job: Job) {
  await $fetch(`/api/backups/jobs/${job.id}`, { method: 'DELETE' })
  confirmingDelete.value = null
  await refreshJobs()
}

/** Full Nextcloud destination path for a job. */
function destPath(job: Job): string {
  const dir = [props.target.rootDir, job.subdirectory].filter(Boolean).join('/')
  return '/' + (dir ? dir + '/' : '') + job.name + '.tar.gz'
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
          <div class="job-name">{{ job.name }}</div>
          <div class="job-meta tsp-muted" data-testid="job-dest">{{ destPath(job) }}</div>
        </div>
        <span class="job-type tsp-muted">
          {{ job.type === 'files' ? 'Files' : job.type }}
        </span>
        <span class="job-status tsp-muted">Never run</span>
        <button
          class="tsp-btn tsp-btn-sm tsp-btn-icon"
          aria-label="Edit job"
          @click="openEdit(job)"
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

    <button class="tsp-btn tsp-btn-sm add-job" @click="openNew">+ Add Job</button>

    <NewBackupWizard
      v-if="wizardOpen"
      :targets="targets"
      :initial-target-id="target.id"
      :job="editingJob ?? undefined"
      @close="closeWizard"
      @saved="onSaved"
    />
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

.job-name {
  font-weight: 700;
  font-size: 0.95rem;
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

.job-type,
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
