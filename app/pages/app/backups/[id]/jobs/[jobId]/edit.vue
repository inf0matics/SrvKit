<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'shell' })

interface Job {
  id: string
  targetId: string
  name: string
  type: string
  sourcePath: string
  output: string
  subdirectory: string
  excludes: string[]
  dateSuffix: boolean
}

const route = useRoute()
const targetId = route.params.id as string
const jobId = route.params.jobId as string

const { targets, refresh: refreshTargets } = useTargets()
onMounted(refreshTargets)
const target = computed(() => targets.value.find((t) => t.id === targetId))

const sources = ref<string[]>([])
onMounted(async () => {
  const { sources: s } = await $fetch<{ sources: string[] }>('/api/backups/sources')
  sources.value = s
})

const { data: job } = await useFetch<Job | null>(`/api/backups/jobs/${jobId}`, {
  server: false,
  default: () => null,
})

const form = reactive({
  name: '',
  type: 'files',
  sourcePath: '',
  output: 'single',
  subdirectory: '',
  dateSuffix: false,
})
const excludes = ref<string[]>([])

watch(
  job,
  (j) => {
    if (!j) return
    form.name = j.name
    form.type = j.type
    form.sourcePath = j.sourcePath
    form.output = j.output
    form.subdirectory = j.subdirectory
    form.dateSuffix = j.dateSuffix
    excludes.value = j.excludes
  },
  { immediate: true },
)

// Full destination: {host}/{root}/{subdirectory}/{name}[_date].tar.gz
const archive = computed(() => {
  const host = (target.value?.host ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const date = new Date().toISOString().slice(0, 10)
  const file = (form.name || 'job') + (form.dateSuffix ? `_${date}` : '') + '.tar.gz'
  const segs = [host, target.value?.rootDir, form.subdirectory].filter(Boolean)
  return [...segs, file].join('/')
})

const saving = ref(false)
const saveError = ref('')

async function save() {
  saving.value = true
  saveError.value = ''
  try {
    await $fetch(`/api/backups/jobs/${jobId}`, {
      method: 'PUT',
      body: {
        targetId,
        name: form.name,
        type: form.type,
        sourcePath: form.sourcePath,
        excludes: excludes.value,
        output: form.output,
        subdirectory: form.subdirectory,
        dateSuffix: form.dateSuffix,
      },
    })
    await navigateTo(`/app/backups/${targetId}`)
  } catch (e: unknown) {
    saveError.value =
      (e as { statusMessage?: string }).statusMessage || 'Could not save job'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page" data-testid="job-edit">
    <NuxtLink :to="`/app/backups/${targetId}`" class="back tsp-link-muted">
      ← Back to target
    </NuxtLink>

    <template v-if="job">
      <h1>Edit job</h1>

      <label class="field">
        <span>Name</span>
        <input v-model="form.name" class="tsp-input" type="text" autocomplete="off">
      </label>

      <!-- Files: source directory + file-tree selection -->
      <template v-if="form.type === 'files'">
        <label class="field">
          <span>Source path</span>
          <select v-model="form.sourcePath" class="tsp-input">
            <option v-for="s in sources" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>

        <div class="field">
          <span class="label">Files</span>
          <FileTreeSelect v-model="excludes" :source-path="form.sourcePath" />
        </div>

        <label class="field">
          <span>Output</span>
          <select v-model="form.output" class="tsp-input">
            <option value="single">Single File</option>
          </select>
        </label>
      </template>

      <!-- SQLite: read-only source file + date-suffix toggle -->
      <template v-else>
        <div class="field">
          <span class="label">Source file</span>
          <input class="tsp-input" :value="`/backups/${form.sourcePath}`" readonly>
        </div>

        <label class="field toggle">
          <input v-model="form.dateSuffix" type="checkbox">
          <span>Append date to filename</span>
        </label>
      </template>

      <label class="field">
        <span>Nextcloud subdirectory</span>
        <input
          v-model="form.subdirectory"
          class="tsp-input"
          type="text"
          placeholder="root"
          autocomplete="off"
        >
      </label>

      <p class="archive tsp-muted" data-testid="archive">Archive: {{ archive }}</p>
      <p v-if="saveError" class="err">{{ saveError }}</p>

      <div class="actions">
        <NuxtLink :to="`/app/backups/${targetId}`" class="tsp-btn tsp-btn-sm">
          Cancel
        </NuxtLink>
        <button
          class="tsp-btn tsp-btn-sm tsp-btn-primary"
          :disabled="saving"
          @click="save"
        >
          Save
        </button>
      </div>
    </template>

    <p v-else class="tsp-muted notfound">Job not found.</p>
  </div>
</template>

<style scoped>
.page {
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 24px 64px;
}

.back {
  display: inline-block;
  margin-bottom: 12px;
}

.page h1 {
  margin: 4px 0 18px;
  font-size: 1.6rem;
}

.field {
  display: block;
  margin-bottom: 1rem;
}

.field span,
.field .label {
  display: block;
  margin-bottom: 0.3rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--tsp-text-muted);
}

.toggle {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle span {
  margin: 0;
  color: var(--tsp-text);
}

.archive {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.85rem;
}

.err {
  color: var(--tsp-danger);
  font-size: 0.9rem;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.5rem;
}

.notfound {
  margin-top: 24px;
}
</style>
