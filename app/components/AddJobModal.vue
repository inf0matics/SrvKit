<script setup lang="ts">
import type { TargetSummary } from '~/composables/useTargets'

interface CreatedJob {
  id: string
}

const props = defineProps<{ target: TargetSummary }>()
const emit = defineEmits<{ close: [] }>()

const form = reactive({ name: '', type: 'files', sourcePath: '' })
const sources = ref<string[]>([])
const dbFiles = ref<string[]>([])
const saving = ref(false)
const error = ref('')

onMounted(async () => {
  const res = await $fetch<{ sources: string[]; dbFiles: string[] }>(
    '/api/backups/sources',
  )
  sources.value = res.sources
  dbFiles.value = res.dbFiles
})

// Mounted paths depend on the type: directories for Files, .db files for SQLite.
const mountedPaths = computed(() =>
  form.type === 'sqlite' ? dbFiles.value : sources.value,
)
watch(
  () => form.type,
  () => (form.sourcePath = ''),
)

const canCreate = computed(() => form.name.trim().length > 0 && !!form.sourcePath)

async function create() {
  saving.value = true
  error.value = ''
  try {
    // Minimal job — file selection and destination are set on the edit page.
    const job = await $fetch<CreatedJob>('/api/backups/jobs', {
      method: 'POST',
      body: {
        targetId: props.target.id,
        name: form.name,
        type: form.type,
        sourcePath: form.sourcePath,
        excludes: [],
        output: 'single',
        subdirectory: '',
      },
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
      <label class="field">
        <span>Mounted path</span>
        <select v-model="form.sourcePath" class="tsp-input">
          <option value="" disabled>Select a mounted path…</option>
          <option v-for="s in mountedPaths" :key="s" :value="s">/backups/{{ s }}</option>
        </select>
      </label>

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
