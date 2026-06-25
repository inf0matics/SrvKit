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
      <button class="tsp-btn" @click="removeJob(job)">Delete</button>
    </div>

    <p v-if="!jobs.length" class="tsp-muted no-jobs">No backup jobs yet.</p>

    <button class="tsp-btn new-backup" @click="wizardOpen = true">+ New Backup</button>

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
.jobs {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--tsp-border);
}

.job {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
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

.no-jobs {
  margin: 0 0 10px;
  font-size: 0.9rem;
}

.new-backup {
  margin-top: 10px;
}
</style>
