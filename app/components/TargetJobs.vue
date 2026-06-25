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
}

const props = defineProps<{ target: TargetSummary; targets: TargetSummary[] }>()

const { data: jobs, refresh: refreshJobs } = await useFetch<Job[]>(
  () => `/api/backups/jobs?targetId=${props.target.id}`,
  { server: false, default: () => [] },
)

const wizardOpen = ref(false)

async function onSaved() {
  wizardOpen.value = false
  await refreshJobs()
}

async function removeJob(job: Job) {
  if (!confirm(`Delete backup "${job.name}"?`)) return
  await $fetch(`/api/backups/jobs/${job.id}`, { method: 'DELETE' })
  await refreshJobs()
}
</script>

<template>
  <div class="jobs">
    <div v-for="job in jobs" :key="job.id" class="job">
      <div class="job-info">
        <div class="job-name">{{ job.name }}</div>
        <div class="job-meta tsp-muted">
          {{ job.sourcePath }} → {{ job.subdirectory }}/{{ job.name }}.tar.gz
        </div>
      </div>
      <span class="job-type tsp-muted">{{ job.type === 'files' ? 'Files' : job.type }}</span>
      <span class="job-status tsp-muted">Never run</span>
      <button class="tsp-btn" @click="removeJob(job)">Delete</button>
    </div>

    <p v-if="!jobs.length" class="tsp-muted no-jobs">No backup jobs yet.</p>

    <button class="tsp-btn add-job" @click="wizardOpen = true">+ Add Job</button>

    <NewBackupWizard
      v-if="wizardOpen"
      :targets="targets"
      :initial-target-id="target.id"
      @close="wizardOpen = false"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped>
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

.job-type,
.job-status {
  font-size: 0.85rem;
  flex-shrink: 0;
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

.no-jobs {
  margin: 0 0 10px;
  font-size: 0.9rem;
}

.add-job {
  margin-top: 12px;
}
</style>
