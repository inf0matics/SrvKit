<script setup lang="ts">
import {
  MIN_KEEP_VERSIONS,
  retentionColumns,
  retentionMode,
  type RetentionMode,
} from '~~/lib/retention'
import { targetArchivePath } from '~/utils/targetPath'

import { matchesDbImage, dbTypeLabel } from '~/utils/containers'

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
  keepVersions: number
  trigger: string
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

usePageTitle(() => job.value?.name ?? 'Edit job')

const form = reactive({
  name: '',
  type: 'files',
  sourcePath: '',
  output: 'single',
  subdirectory: '',
  // The filename suffixes are the user's own under Off, and fixed on under a
  // managed rotation — either way the form holds what will be saved.
  dateSuffix: false,
  timeSuffix: false,
  retentionMode: 'off' as RetentionMode,
  keepVersions: 7,
  trigger: 'filewatcher',
  container: '',
  database: '',
  dbUser: '',
  dbPassword: '',
  schedule: '',
})
const includes = ref<string[]>([])
// What the job looked like when it loaded, so an unrelated save cannot silently
// rewrite a filename scheme the user never touched.
const loadedMode = ref<RetentionMode>('off')
const loadedName = ref('')
const hasDbPassword = ref(false)
const walDetected = ref(false)

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
    form.retentionMode = retentionMode(j.keepVersions)
    loadedMode.value = form.retentionMode
    loadedName.value = j.name
    // Keep a sensible number in the box even while another mode is selected.
    form.keepVersions = j.keepVersions || 7
    form.timeSuffix = j.timeSuffix
    form.trigger = j.trigger
    form.container = j.container
    form.database = j.database
    form.dbUser = j.dbUser
    form.schedule = j.schedule
    hasDbPassword.value = j.hasDbPassword
    includes.value = j.includes
  },
  { immediate: true },
)

// SQLite: detect WAL mode when a source file is picked. WAL databases can only
// be cron-triggered (the filewatcher is unreliable), so lock the trigger to Cron.
watch(
  () => form.sourcePath,
  async (path) => {
    if (form.type !== 'sqlite' || !path) {
      walDetected.value = false
      return
    }
    try {
      const { wal } = await $fetch<{ wal: boolean }>('/api/fs/wal-check', {
        params: { path },
      })
      walDetected.value = wal
      if (wal) form.trigger = 'cron'
    } catch {
      walDetected.value = false
    }
  },
)

// Running Docker containers for the PostgreSQL/MySQL container picker.
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

// Filter the dropdown to DB containers by image (unless "show all" is checked).
const showAllContainers = ref(false)
const filteredContainers = computed(() =>
  showAllContainers.value
    ? containers.value
    : containers.value.filter((c) => matchesDbImage(c.image, form.type)),
)

const isLocalTarget = computed(() => target.value?.type === 'local')

/** Both managed rotations fix the filename suffixes; Off leaves them to the user. */
const rotationManaged = computed(() => form.retentionMode !== 'off')

/**
 * A managed rotation needs every run to be its own file, so it switches both
 * suffixes on and locks them. Driving the form state (rather than only the
 * checkbox's rendering) keeps what is shown and what is saved the same thing.
 */
// Immediate, because the job is already loaded by the time this runs (the
// useFetch above is awaited), so a lazy watcher would never see the initial
// rotation and the checkboxes would contradict the filename below them.
watch(
  rotationManaged,
  (managed) => {
    if (managed) {
      form.dateSuffix = true
      form.timeSuffix = true
    }
  },
  { immediate: true },
)

// A time on its own cannot order versions across days, so it goes with the date.
watch(
  () => form.dateSuffix,
  (dated) => {
    if (!dated) form.timeSuffix = false
  },
)

/**
 * The count as a usable whole number. The field can hold an empty string or a
 * half-typed value, and the API refuses anything that is not a whole count —
 * so clamp here rather than letting the form produce a request it will reject.
 */
const keepCount = computed(() => {
  const n = Math.floor(Number(form.keepVersions))
  return Number.isFinite(n) ? Math.max(n, MIN_KEEP_VERSIONS) : MIN_KEEP_VERSIONS
})

/** Archives are matched by name, so a rename walks away from the old ones. */
const renameOrphansHistory = computed(
  () => rotationManaged.value && !!loadedName.value && form.name !== loadedName.value,
)

const retention = computed(() =>
  retentionColumns(form.retentionMode, keepCount.value, form),
)

// Full destination — the same formatter the job list uses, so the two pages
// can never disagree about the filename a job produces.
const archive = computed(() =>
  targetArchivePath(target.value, {
    name: form.name,
    subdirectory: form.subdirectory,
    dateSuffix: retention.value.dateSuffix,
    timeSuffix: retention.value.timeSuffix,
  }),
)

const saving = ref(false)
const saveError = ref('')

/**
 * Nothing is marked until Save has been pressed once. The page opens on a job
 * that is deliberately incomplete — Add Job creates it with just a name — so
 * marking from the start would flag fields the user has not reached yet.
 */
const checked = ref(false)
/**
 * The field an API refusal named, for the checks only the server can run (a
 * file that turns out not to be a SQLite database, a name already writing to
 * that folder). Cleared on the next attempt.
 */
const serverField = ref('')

const problems = computed(() => jobProblems(form, includes.value, hasDbPassword.value))

// The API judged what was sent; any edit makes that verdict stale.
watch([form, includes], () => {
  serverField.value = ''
})

/** The pre-check message to show under `field`, or '' while it is not at fault. */
function fieldError(field: string): string {
  if (!checked.value) return ''
  return problems.value.find((p) => p.field === field)?.message ?? ''
}

/**
 * Whether to mark `field` red. A refusal from the API marks its field but keeps
 * its wording in the one report below the form: the API can name a field this
 * page has no message slot for, and a message shown nowhere is worse than one
 * shown away from its input.
 */
function fieldInvalid(field: string): boolean {
  return serverField.value === field || !!fieldError(field)
}

/**
 * The one report beside Save: the pre-check count while the form is still
 * incomplete (a count only — the detail sits under each field), otherwise
 * whatever the API said. Derived rather than stored, so filling a field in
 * updates it instead of leaving the number from the failed attempt on screen.
 */
const report = computed(() => {
  // `checked` first: until Save has been pressed this must not depend on the
  // form at all, or every keystroke re-runs a pre-check nothing is showing.
  if (!checked.value) return saveError.value
  const n = problems.value.length
  if (n === 0) return saveError.value
  return n === 1
    ? '1 field needs attention (highlighted above).'
    : `${n} fields need attention (highlighted above).`
})

/**
 * The form is long and Save sits at the bottom, so a marked field can easily be
 * off-screen. Bring the topmost one into view — `problems` is in form order, so
 * the first match in document order is the first problem.
 */
async function revealFirstProblem() {
  await nextTick()
  const field = document.querySelector('.field.invalid')
  if (!field) return
  field.scrollIntoView({ block: 'center', behavior: 'smooth' })
  field
    .querySelector<HTMLElement>('input:not([disabled]), select:not([disabled])')
    ?.focus()
}

async function save() {
  checked.value = true
  serverField.value = ''
  saveError.value = ''
  // Don't send a request the API is certain to refuse — and say which fields.
  if (problems.value.length) {
    await revealFirstProblem()
    return
  }
  saving.value = true
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
        dateSuffix: retention.value.dateSuffix,
        timeSuffix: retention.value.timeSuffix,
        keepVersions: retention.value.keepVersions,
        trigger: form.trigger,
        container: form.container,
        database: form.database,
        dbUser: form.dbUser,
        dbPassword: form.dbPassword, // blank = keep stored password
        schedule: form.schedule,
      },
    })
    await navigateTo(`/app/backups/${targetId}`)
  } catch (e: unknown) {
    saveError.value = apiErrorMessage(e, 'Could not save job')
    serverField.value = apiErrorField(e)
    if (serverField.value) await revealFirstProblem()
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

      <label class="field" :class="{ invalid: fieldInvalid('name') }">
        <span>Name</span>
        <input
          v-model="form.name"
          class="tsp-input"
          type="text"
          autocomplete="off"
          :aria-invalid="fieldInvalid('name') || undefined"
        >
        <p v-if="fieldError('name')" class="field-err" data-testid="err-name">
          {{ fieldError('name') }}
        </p>
      </label>

      <!-- Files: source directory + file-tree selection -->
      <template v-if="form.type === 'files'">
        <label class="field" :class="{ invalid: fieldInvalid('sourcePath') }">
          <span>Source path</span>
          <select
            v-model="form.sourcePath"
            class="tsp-input"
            :aria-invalid="fieldInvalid('sourcePath') || undefined"
          >
            <option value="" disabled>Select a source directory…</option>
            <option v-for="s in sources" :key="s" :value="s">{{ s }}</option>
          </select>
          <p v-if="fieldError('sourcePath')" class="field-err" data-testid="err-sourcePath">
            {{ fieldError('sourcePath') }}
          </p>
        </label>

        <div class="field" :class="{ invalid: fieldInvalid('includes') }">
          <span class="label">Files (nothing selected by default)</span>
          <FileTreeSelect
            v-if="form.sourcePath"
            v-model="includes"
            :source-path="form.sourcePath"
          />
          <p v-else class="hint tsp-muted">Select a source directory first.</p>
          <p v-if="fieldError('includes')" class="field-err" data-testid="err-includes">
            {{ fieldError('includes') }}
          </p>
        </div>

        <label class="field">
          <span>Output</span>
          <!-- One option today; a chooser with a single choice is just noise. -->
          <select v-model="form.output" class="tsp-input" disabled>
            <option value="single">Single File</option>
          </select>
        </label>
      </template>

      <!-- SQLite: browse for the .db file -->
      <template v-else-if="form.type === 'sqlite'">
        <div class="field" :class="{ invalid: fieldInvalid('sourcePath') }">
          <span class="label">Source file</span>
          <FilePicker v-model="form.sourcePath" />
          <input
            class="tsp-input selected"
            :value="form.sourcePath ? `/backups/${form.sourcePath}` : ''"
            placeholder="No file selected"
            readonly
          >
          <p v-if="fieldError('sourcePath')" class="field-err" data-testid="err-sourcePath">
            {{ fieldError('sourcePath') }}
          </p>
        </div>

        <label class="field">
          <span>Trigger</span>
          <select v-model="form.trigger" class="tsp-input" data-testid="trigger">
            <option value="filewatcher" :disabled="walDetected">Filewatcher</option>
            <option value="cron">Cron</option>
          </select>
        </label>
        <p v-if="walDetected" class="warn-box" data-testid="wal-notice">
          ℹ️ This database uses WAL mode. Filewatcher is not reliable in WAL mode —
          a cron schedule is required.
        </p>

        <div
          v-if="form.trigger === 'cron'"
          class="field"
          :class="{ invalid: fieldInvalid('schedule') }"
        >
          <span class="label">Schedule (cron)</span>
          <CronField v-model="form.schedule" />
          <p v-if="fieldError('schedule')" class="field-err" data-testid="err-schedule">
            {{ fieldError('schedule') }}
          </p>
        </div>
      </template>

      <!-- PostgreSQL / MySQL: dump inside a Docker container on a cron schedule -->
      <template v-else>
        <p v-if="!dockerAvailable" class="warn-box" data-testid="docker-warning">
          ⚠️ Docker socket not mounted. Mount
          <code>/var/run/docker.sock</code> into SrvKit to run database backups.
        </p>

        <div class="field" :class="{ invalid: fieldInvalid('container') }">
          <span class="label">Container</span>
          <select
            v-model="form.container"
            class="tsp-input"
            data-testid="pg-container"
            :aria-invalid="fieldInvalid('container') || undefined"
          >
            <option value="" disabled>Select a container…</option>
            <option
              v-if="form.container && !filteredContainers.some((c) => c.name === form.container)"
              :value="form.container"
            >
              {{ form.container }} (not in list)
            </option>
            <option v-for="c in filteredContainers" :key="c.id" :value="c.name">
              {{ c.name }} ({{ c.image }})
            </option>
          </select>
          <p
            v-if="dockerAvailable && !showAllContainers && !filteredContainers.length"
            class="hint tsp-muted"
            data-testid="no-containers"
          >
            No {{ dbTypeLabel(form.type) }} containers found. Check
            “Show all containers” to select from the full list.
          </p>
          <label class="field toggle show-all">
            <input v-model="showAllContainers" type="checkbox" data-testid="show-all-containers">
            <span>Show all containers</span>
          </label>
          <p v-if="fieldError('container')" class="field-err" data-testid="err-container">
            {{ fieldError('container') }}
          </p>
        </div>

        <label class="field" :class="{ invalid: fieldInvalid('database') }">
          <span>Database</span>
          <input
            v-model="form.database"
            class="tsp-input"
            type="text"
            autocomplete="off"
            :aria-invalid="fieldInvalid('database') || undefined"
          >
          <p v-if="fieldError('database')" class="field-err" data-testid="err-database">
            {{ fieldError('database') }}
          </p>
        </label>
        <label class="field" :class="{ invalid: fieldInvalid('dbUser') }">
          <span>User</span>
          <input
            v-model="form.dbUser"
            class="tsp-input"
            type="text"
            autocomplete="off"
            :aria-invalid="fieldInvalid('dbUser') || undefined"
          >
          <p v-if="fieldError('dbUser')" class="field-err" data-testid="err-dbUser">
            {{ fieldError('dbUser') }}
          </p>
        </label>
        <label class="field" :class="{ invalid: fieldInvalid('dbPassword') }">
          <span>Password</span>
          <input
            v-model="form.dbPassword"
            class="tsp-input"
            type="password"
            autocomplete="off"
            :placeholder="hasDbPassword ? '•••••••• (stored — leave blank to keep)' : 'Database password'"
            :aria-invalid="fieldInvalid('dbPassword') || undefined"
          >
          <p v-if="fieldError('dbPassword')" class="field-err" data-testid="err-dbPassword">
            {{ fieldError('dbPassword') }}
          </p>
        </label>
        <div class="field" :class="{ invalid: fieldInvalid('schedule') }">
          <span class="label">Schedule (cron)</span>
          <CronField v-model="form.schedule" />
          <p v-if="fieldError('schedule')" class="field-err" data-testid="err-schedule">
            {{ fieldError('schedule') }}
          </p>
        </div>
      </template>

      <label class="field" :class="{ invalid: fieldInvalid('subdirectory') }">
        <span>{{ isLocalTarget ? 'Target subdirectory' : 'Nextcloud subdirectory' }}</span>
        <input
          v-model="form.subdirectory"
          class="tsp-input"
          type="text"
          placeholder="root"
          autocomplete="off"
          :aria-invalid="fieldInvalid('subdirectory') || undefined"
        >
        <p v-if="fieldError('subdirectory')" class="field-err" data-testid="err-subdirectory">
          {{ fieldError('subdirectory') }}
        </p>
      </label>

      <fieldset class="field retention" data-testid="retention">
        <legend>Backup Rotation</legend>

        <label class="radio">
          <input v-model="form.retentionMode" type="radio" name="retention" value="off">
          <span>Off — SrvKit deletes nothing; the filename decides</span>
        </label>

        <label class="radio">
          <input v-model="form.retentionMode" type="radio" name="retention" value="keep">
          <span>
            Keep the newest
            <input
              v-model.number="form.keepVersions"
              class="tsp-input keep-count"
              type="number"
              :min="MIN_KEEP_VERSIONS"
              max="999"
              step="1"
              data-testid="keep-count"
              aria-label="Versions to keep"
              @focus="form.retentionMode = 'keep'"
            >
            versions
          </span>
        </label>

        <p v-if="form.retentionMode === 'keep'" class="tsp-muted hint">
          Older archives are removed after the next successful run — saving does
          not delete anything.
          <br>
          <strong>Archives already in that folder count too</strong>, so the next
          run removes everything beyond the newest {{ keepCount }}, including
          versions written before this setting.
          <br>
          Newest is decided by the <strong>date in the filename</strong>, not by
          the file's timestamp — so copying or restoring archives cannot change
          which ones survive.
        </p>

        <p
          v-if="renameOrphansHistory"
          class="tsp-muted hint"
          data-testid="rename-note"
        >
          Renaming leaves the existing “{{ loadedName }}” archives where they
          are — they are no longer counted or removed by this job.
        </p>
      </fieldset>

      <!-- Outside the box on purpose: under a managed rotation these are what
           makes each run its own version, so they are shown switched on and
           locked rather than hidden. Under Off they are the user's to choose. -->
      <label class="field toggle">
        <input
          v-model="form.dateSuffix"
          type="checkbox"
          :disabled="rotationManaged"
          data-testid="date-suffix"
        >
        <span>Append date to filename (_YYYY-MM-DD)</span>
      </label>
      <label class="field toggle">
        <input
          v-model="form.timeSuffix"
          type="checkbox"
          :disabled="rotationManaged || !form.dateSuffix"
          data-testid="time-suffix"
        >
        <span>Append time to filename (_HH-MM-SS)</span>
      </label>

      <p class="archive tsp-muted" data-testid="archive">Archive: {{ archive }}</p>
      <p v-if="report" class="err" data-testid="save-error">{{ report }}</p>

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

.show-all {
  margin-top: 6px;
  margin-bottom: 0;
  font-weight: 400;
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

.retention {
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius);
  padding: 12px 14px 4px;
  margin-bottom: 0.9rem;
}

.retention legend {
  padding: 0 6px;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--tsp-text-muted);
}

.radio {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 0.5rem;
  cursor: pointer;
}

.radio span {
  display: flex;
  align-items: center;
  gap: 6px;
}

.keep-count {
  width: 5.5rem;
  padding: 3px 6px;
}

.hint {
  font-size: 0.8rem;
  line-height: 1.45;
}

.archive {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.85rem;
}

.err {
  color: var(--tsp-danger);
  font-size: 0.9rem;
}

/* A field at fault: red label, red border on an input that is its own, and the
   reason right underneath. The components (file picker, cron field) carry inner
   inputs that are not the thing at fault, so they are left alone. */
.field.invalid > span,
.field.invalid > .label {
  color: var(--tsp-danger);
}

.field.invalid > .tsp-input {
  border-color: var(--tsp-danger);
}

.field-err {
  margin: 0.3rem 0 0;
  font-size: 0.8rem;
  color: var(--tsp-danger);
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
