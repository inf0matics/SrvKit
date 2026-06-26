<script setup lang="ts">
import type { TargetSummary } from '~/composables/useTargets'

interface CreatedJob {
  id: string
}

const props = defineProps<{ target: TargetSummary }>()
const emit = defineEmits<{ close: [] }>()

const form = reactive({ name: '', type: 'files' })
const saving = ref(false)
const error = ref('')

const TYPE_INFO: Record<string, string> = {
  files:
    'Watches selected files and directories for changes and backs them up as a tar.gz archive.',
  sqlite:
    'Watches a SQLite database file for changes and creates a safe point-in-time backup using the SQLite Online Backup API.',
}

const canCreate = computed(() => form.name.trim().length > 0)

async function create() {
  saving.value = true
  error.value = ''
  try {
    const job = await $fetch<CreatedJob>('/api/backups/jobs', {
      method: 'POST',
      body: { targetId: props.target.id, name: form.name, type: form.type },
    })
    await navigateTo(`/app/backups/${props.target.id}/jobs/${job.id}/edit`)
  } catch (e: unknown) {
    error.value =
      (e as { statusMessage?: string }).statusMessage || 'Could not create job'
    saving.value = false
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="tsp-card">
      <div class="head">
        <h2>New backup job</h2>
        <button class="tsp-btn tsp-btn-sm" aria-label="Close" @click="emit('close')">
          ✕
        </button>
      </div>

      <label class="field">
        <span>Name</span>
        <input v-model="form.name" class="tsp-input" type="text" autocomplete="off">
      </label>
      <label class="field">
        <span>Type</span>
        <select v-model="form.type" class="tsp-input">
          <option value="files">Files</option>
          <option value="sqlite">SQLite</option>
        </select>
      </label>

      <p class="info" data-testid="type-info">{{ TYPE_INFO[form.type] }}</p>

      <p v-if="error" class="err">{{ error }}</p>

      <div class="actions">
        <button class="tsp-btn tsp-btn-sm" @click="emit('close')">Cancel</button>
        <button
          class="tsp-btn tsp-btn-sm tsp-btn-primary"
          :disabled="!canCreate || saving"
          @click="create"
        >
          Create →
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.head h2 {
  margin: 0;
  font-size: 1.2rem;
}

.field {
  display: block;
  margin-bottom: 0.9rem;
}

.field span {
  display: block;
  margin-bottom: 0.3rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--tsp-text-muted);
}

.info {
  margin: 0;
  padding: 10px 12px;
  background: var(--tsp-bg);
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius-sm);
  font-size: 0.85rem;
  color: var(--tsp-text-muted);
}

.err {
  color: var(--tsp-danger);
  font-size: 0.9rem;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.25rem;
}
</style>
