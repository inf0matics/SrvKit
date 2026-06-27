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
  includes: string[]
  dateSuffix: boolean
  timeSuffix: boolean
  container: string
  database: string
  dbUser: string
  hasDbPassword: boolean
  schedule: string
  nextRun: string | null
}

interface DockerContainer {
  id: string
  name: string
  image: string
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
  timeSuffix: false,
  container: '',
  database: '',
  dbUser: '',
  dbPassword: '',
  schedule: '',
})
const includes = ref<string[]>([])
const hasDbPassword = ref(false)
const nextRun = ref<string | null>(null)

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
    form.timeSuffix = j.timeSuffix
    form.container = j.container
    form.database = j.database
    form.dbUser = j.dbUser
    form.schedule = j.schedule
    hasDbPassword.value = j.hasDbPassword
    nextRun.value = j.nextRun
    includes.value = j.includes
  },
  { immediate: true },
)

// Running Docker containers for the PostgreSQL container picker.
const dockerAvailable = ref(true)
const containers = ref<DockerContainer[]>([])
onMounted(async () => {
  try {
    const res = await $fetch<{ available: boolean; containers: DockerContainer[] }>(
      '/api/docker/containers',
    )
    dockerAvailable.value = res.available
    containers.value = res.containers
  } catch {
    dockerAvailable.value = false
  }
})

const fmtNextRun = computed(() =>
  nextRun.value ? new Date(nextRun.value).toLocaleString() : '—',
)

// Full destination: {host}/{root}/{subdirectory}/{name}[_date][_time].tar.gz
const archive = computed(() => {
  const host = (target.value?.host ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const iso = new Date().toISOString()
  const date = form.dateSuffix ? `_${iso.slice(0, 10)}` : ''
  const time = form.timeSuffix ? `_${iso.slice(11, 19).replace(/:/g, '-')}` : ''
  const file = (form.name || 'job') + date + time + '.tar.gz'
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
        includes: includes.value,
        output: form.output,
        subdirectory: form.subdirectory,
        dateSuffix: form.dateSuffix,
        timeSuffix: form.timeSuffix,
        container: form.container,
        database: form.database,
        dbUser: form.dbUser,
        dbPassword: form.dbPassword, // blank = keep stored password
        schedule: form.schedule,
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
            <option value="" disabled>Select a source directory…</option>
            <option v-for="s in sources" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>

        <div class="field">
          <span class="label">Files (nothing selected by default)</span>
          <FileTreeSelect
            v-if="form.sourcePath"
            v-model="includes"
            :source-path="form.sourcePath"
          />
          <p v-else class="hint tsp-muted">Select a source directory first.</p>
        </div>

        <label class="field">
          <span>Output</span>
          <select v-model="form.output" class="tsp-input">
            <option value="single">Single File</option>
          </select>
        </label>
      </template>

      <!-- SQLite: browse for the .db file -->
      <template v-else-if="form.type === 'sqlite'">
        <div class="field">
          <span class="label">Source file</span>
          <FilePicker v-model="form.sourcePath" />
          <input
            class="tsp-input selected"
            :value="form.sourcePath ? `/backups/${form.sourcePath}` : ''"
            placeholder="No file selected"
            readonly
          >
        </div>
      </template>

      <!-- PostgreSQL: pg_dump inside a Docker container on a cron schedule -->
      <template v-else>
        <p v-if="!dockerAvailable" class="warn-box" data-testid="docker-warning">
          ⚠️ Docker socket not mounted. Mount
          <code>/var/run/docker.sock</code> into SrvKit to run PostgreSQL backups.
        </p>

        <label class="field">
          <span>Container</span>
          <select v-model="form.container" class="tsp-input" data-testid="pg-container">
            <option value="" disabled>Select a container…</option>
            <option v-if="form.container && !containers.some((c) => c.name === form.container)" :value="form.container">
              {{ form.container }} (not running)
            </option>
            <option v-for="c in containers" :key="c.id" :value="c.name">
              {{ c.name }} ({{ c.image }})
            </option>
          </select>
        </label>

        <label class="field">
          <span>Database</span>
          <input v-model="form.database" class="tsp-input" type="text" autocomplete="off">
        </label>
        <label class="field">
          <span>User</span>
          <input v-model="form.dbUser" class="tsp-input" type="text" autocomplete="off">
        </label>
        <label class="field">
          <span>Password</span>
          <input
            v-model="form.dbPassword"
            class="tsp-input"
            type="password"
            autocomplete="off"
            :placeholder="hasDbPassword ? '•••••••• (stored — leave blank to keep)' : 'Database password'"
          >
        </label>
        <label class="field">
          <span>Schedule (cron)</span>
          <input
            v-model="form.schedule"
            class="tsp-input"
            type="text"
            placeholder="0 3 * * *"
            autocomplete="off"
          >
          <span class="hint tsp-muted">Next run: {{ fmtNextRun }}</span>
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

      <label class="field toggle">
        <input v-model="form.dateSuffix" type="checkbox">
        <span>Append date to filename (_YYYY-MM-DD)</span>
      </label>
      <label class="field toggle">
        <input v-model="form.timeSuffix" type="checkbox">
        <span>Append time to filename (_HH-MM-SS)</span>
      </label>
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

.hint {
  margin: 0;
  font-size: 0.9rem;
}

.warn-box {
  margin: 0 0 1rem;
  padding: 10px 12px;
  background: var(--tsp-surface);
  border: 1px solid var(--tsp-primary);
  border-radius: var(--tsp-radius-sm);
  font-size: 0.85rem;
}

.warn-box code,
.hint code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.8rem;
}

.selected {
  margin-top: 8px;
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
