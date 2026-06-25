<script setup lang="ts">
interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
}
interface FlatNode {
  name: string
  path: string
  type: 'file' | 'dir'
  depth: number
  parentPath: string
}
interface Target {
  id: string
  name: string
}

interface JobEdit {
  id: string
  name: string
  type: string
  sourcePath: string
  targetId: string
  output: string
  subdirectory: string
  excludes: string[]
}

const props = defineProps<{
  targets: Target[]
  initialTargetId: string
  job?: JobEdit
}>()
const emit = defineEmits<{ close: []; saved: [] }>()

const isEdit = computed(() => !!props.job)
const step = ref(1)
const form = reactive({
  name: props.job?.name ?? '',
  type: props.job?.type ?? 'files',
  sourcePath: props.job?.sourcePath ?? '',
  targetId: props.job?.targetId ?? props.initialTargetId,
  output: props.job?.output ?? 'single',
  subdirectory: props.job?.subdirectory ?? '',
})

/* ---- sources + tree ---- */
const sources = ref<string[]>([])
const flat = ref<FlatNode[]>([])
const checked = ref<Set<string>>(new Set())
const treeLoading = ref(false)
const treeError = ref('')

onMounted(async () => {
  const { sources: s } = await $fetch<{ sources: string[] }>('/api/backups/sources')
  sources.value = s
  // Editing: load the tree and restore the saved selection (uncheck excludes).
  if (props.job?.sourcePath) {
    await loadTree()
    applyExcludes(props.job.excludes)
  }
})

function applyExcludes(excludes: string[]) {
  const next = new Set(checked.value)
  for (const ex of excludes) {
    for (const f of flat.value) {
      if (f.path === ex || f.path.startsWith(ex + '/')) next.delete(f.path)
    }
  }
  checked.value = next
}

function flatten(nodes: TreeNode[], depth: number, parent: string, out: FlatNode[]) {
  for (const n of nodes) {
    out.push({ name: n.name, path: n.path, type: n.type, depth, parentPath: parent })
    if (n.children) flatten(n.children, depth + 1, n.path, out)
  }
}

async function loadTree() {
  if (!form.sourcePath) return
  treeLoading.value = true
  treeError.value = ''
  try {
    const { tree } = await $fetch<{ tree: TreeNode[] }>(
      `/api/backups/sources/${encodeURIComponent(form.sourcePath)}/tree`,
    )
    const out: FlatNode[] = []
    flatten(tree, 0, '', out)
    flat.value = out
    checked.value = new Set(out.map((n) => n.path)) // all selected by default
  } catch {
    flat.value = []
    treeError.value = 'Could not read the source directory'
  } finally {
    treeLoading.value = false
  }
}

const isChecked = (path: string) => checked.value.has(path)

function toggle(node: FlatNode) {
  const turnOn = !checked.value.has(node.path)
  const next = new Set(checked.value)
  for (const f of flat.value) {
    if (f.path === node.path || f.path.startsWith(node.path + '/')) {
      if (turnOn) next.add(f.path)
      else next.delete(f.path)
    }
  }
  checked.value = next
}

// Minimal exclude set: an unchecked node whose parent is still checked.
function computeExcludes(): string[] {
  return flat.value
    .filter(
      (n) =>
        !checked.value.has(n.path) &&
        (n.parentPath === '' || checked.value.has(n.parentPath)),
    )
    .map((n) => n.path)
}

/* ---- step flow ---- */
const canNext = computed(() => {
  if (step.value === 1) return form.name.trim().length > 0
  if (step.value === 2) return form.sourcePath.length > 0 && !treeLoading.value
  return true
})

function next() {
  if (step.value < 3 && canNext.value) step.value++
}
function back() {
  if (step.value > 1) step.value--
}

/* ---- save ---- */
const saving = ref(false)
const saveError = ref('')

async function save() {
  saving.value = true
  saveError.value = ''
  try {
    await $fetch(props.job ? `/api/backups/jobs/${props.job.id}` : '/api/backups/jobs', {
      method: props.job ? 'PUT' : 'POST',
      body: {
        targetId: form.targetId,
        name: form.name,
        type: form.type,
        sourcePath: form.sourcePath,
        excludes: computeExcludes(),
        output: form.output,
        subdirectory: form.subdirectory,
      },
    })
    emit('saved')
  } catch (e: unknown) {
    saveError.value =
      (e as { statusMessage?: string }).statusMessage || 'Could not save job'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="tsp-card wizard">
      <div class="wiz-head">
        <h2>{{ isEdit ? 'Edit Backup' : 'New Backup' }} — step {{ step }} of 3</h2>
        <button class="tsp-btn close" aria-label="Close" @click="emit('close')">✕</button>
      </div>

      <!-- Step 1: Name & Type -->
      <div v-if="step === 1" class="wiz-body">
        <label class="field">
          <span>Name</span>
          <input v-model="form.name" class="tsp-input" type="text" autocomplete="off">
        </label>
        <label class="field">
          <span>Type</span>
          <select v-model="form.type" class="tsp-input">
            <option value="files">Files</option>
          </select>
        </label>
      </div>

      <!-- Step 2: Source path + file tree -->
      <div v-else-if="step === 2" class="wiz-body">
        <label class="field">
          <span>Source path</span>
          <select
            v-model="form.sourcePath"
            class="tsp-input"
            @change="loadTree"
          >
            <option value="" disabled>Select a mounted path…</option>
            <option v-for="s in sources" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>

        <p v-if="!sources.length" class="tsp-muted">
          No sources mounted under the backup base directory.
        </p>

        <div v-if="form.sourcePath" class="tree">
          <p v-if="treeLoading" class="tsp-muted pad">Loading…</p>
          <p v-else-if="treeError" class="test-err pad">{{ treeError }}</p>
          <p v-else-if="!flat.length" class="tsp-muted pad">This directory is empty.</p>
          <label
            v-for="n in flat"
            :key="n.path"
            class="tree-row"
            :style="{ paddingLeft: 8 + n.depth * 18 + 'px' }"
          >
            <input type="checkbox" :checked="isChecked(n.path)" @change="toggle(n)">
            <AppIcon :name="n.type === 'dir' ? 'folder' : 'tag'" />
            <span>{{ n.name }}</span>
          </label>
        </div>
      </div>

      <!-- Step 3: Destination -->
      <div v-else class="wiz-body">
        <label class="field">
          <span>Target</span>
          <select v-model="form.targetId" class="tsp-input">
            <option v-for="t in targets" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
        </label>
        <label class="field">
          <span>Output</span>
          <select v-model="form.output" class="tsp-input">
            <option value="single">Single File</option>
          </select>
        </label>
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
        <p class="tsp-muted out">Archive: {{ form.subdirectory || '' }}/{{ form.name || 'job' }}.tar.gz</p>
        <p v-if="saveError" class="test-err">{{ saveError }}</p>
      </div>

      <div class="wiz-actions">
        <button v-if="step > 1" class="tsp-btn tsp-btn-sm" @click="back">Back</button>
        <span class="spacer" />
        <button class="tsp-btn tsp-btn-sm" @click="emit('close')">Cancel</button>
        <button
          v-if="step < 3"
          class="tsp-btn tsp-btn-sm tsp-btn-primary"
          :disabled="!canNext"
          @click="next"
        >
          Next
        </button>
        <button
          v-else
          class="tsp-btn tsp-btn-sm tsp-btn-primary"
          :disabled="saving"
          @click="save"
        >
          Save
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

.wizard {
  width: 100%;
  max-width: 34rem;
  display: flex;
  flex-direction: column;
  max-height: 85vh;
}

.wiz-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.wiz-head h2 {
  margin: 0;
  font-size: 1.2rem;
}

.close {
  padding: 0.25rem 0.5rem;
}

.wiz-body {
  flex: 1;
  overflow-y: auto;
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

.tree {
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius-sm);
  max-height: 18rem;
  overflow-y: auto;
  padding: 4px;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  font-size: 0.9rem;
  border-radius: var(--tsp-radius-sm);
  cursor: pointer;
}

.tree-row:hover {
  background: var(--tsp-bg);
}

.tree .pad {
  padding: 8px;
  margin: 0;
}

.out {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.85rem;
}

.wiz-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1.25rem;
}

.spacer {
  flex: 1;
}

.test-err {
  color: var(--tsp-danger);
  font-size: 0.9rem;
}
</style>
