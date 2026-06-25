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

const props = defineProps<{ sourcePath: string; modelValue: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [string[]] }>()

const flat = ref<FlatNode[]>([])
const checked = ref<Set<string>>(new Set())
const loading = ref(false)
const error = ref('')

function flatten(nodes: TreeNode[], depth: number, parent: string, out: FlatNode[]) {
  for (const n of nodes) {
    out.push({ name: n.name, path: n.path, type: n.type, depth, parentPath: parent })
    if (n.children) flatten(n.children, depth + 1, n.path, out)
  }
}

const isChecked = (path: string) => checked.value.has(path)

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

async function load(excludes: string[]) {
  if (!props.sourcePath) return
  loading.value = true
  error.value = ''
  try {
    const { tree } = await $fetch<{ tree: TreeNode[] }>(
      `/api/backups/sources/${encodeURIComponent(props.sourcePath)}/tree`,
    )
    const out: FlatNode[] = []
    flatten(tree, 0, '', out)
    flat.value = out
    const set = new Set(out.map((n) => n.path)) // all selected by default
    for (const ex of excludes) {
      for (const f of out) {
        if (f.path === ex || f.path.startsWith(ex + '/')) set.delete(f.path)
      }
    }
    checked.value = set
    emit('update:modelValue', computeExcludes())
  } catch {
    flat.value = []
    error.value = 'Could not read the source directory'
  } finally {
    loading.value = false
  }
}

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
  emit('update:modelValue', computeExcludes())
}

onMounted(() => load(props.modelValue))
// A new source starts fully selected.
watch(() => props.sourcePath, () => load([]))
</script>

<template>
  <div class="tree">
    <p v-if="loading" class="tsp-muted pad">Loading…</p>
    <p v-else-if="error" class="err pad">{{ error }}</p>
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
</template>

<style scoped>
.tree {
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius-sm);
  max-height: 22rem;
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

.err {
  padding: 8px;
  margin: 0;
  color: var(--tsp-danger);
  font-size: 0.9rem;
}
</style>
