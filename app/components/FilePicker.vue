<script setup lang="ts">
import {
  lazyTreeKey,
  fetchChildren,
  type ChildNode,
  type LazyTreeController,
} from '~/utils/lazyTree'

// v-model is the base-relative path of the selected file ('' = none).
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const cache = reactive<Record<string, ChildNode[]>>({})
const expanded = reactive(new Set<string>())
const loading = reactive(new Set<string>())
const selected = ref(props.modelValue)
const filter = ref('')

async function load(basePath: string) {
  if (cache[basePath]) return
  loading.add(basePath)
  try {
    cache[basePath] = await fetchChildren(basePath)
  } catch {
    cache[basePath] = []
  } finally {
    loading.delete(basePath)
  }
}

const ctrl: LazyTreeController = {
  mode: 'pick',
  childrenOf: (p) => cache[p] ?? [],
  isExpanded: (p) => expanded.has(p),
  isLoading: (p) => loading.has(p),
  async toggleExpand(node) {
    if (expanded.has(node.path)) {
      expanded.delete(node.path)
      return
    }
    await load(node.path)
    expanded.add(node.path)
  },
  isChecked: () => false,
  isDisabled: () => false,
  toggleCheck: () => {},
  isSelected: (node) => node.type === 'file' && selected.value === node.path,
  selectFile(node) {
    if (node.type !== 'file') return
    selected.value = node.path
    emit('update:modelValue', node.path)
  },
  matches(node) {
    const f = filter.value.trim().toLowerCase()
    if (!f || node.type === 'dir') return true // keep folders for navigation
    return node.name.toLowerCase().includes(f)
  },
}
provide(lazyTreeKey, ctrl)

const rootChildren = computed(() => cache[''] ?? [])

onMounted(() => load(''))
</script>

<template>
  <div class="picker">
    <input
      v-model="filter"
      class="tsp-input filter"
      type="text"
      placeholder="Filter by filename…"
      aria-label="Filter by filename"
    >
    <div class="tree">
      <p v-if="loading.has('') && !cache['']" class="tsp-muted pad">Loading…</p>
      <p v-else-if="!rootChildren.length" class="tsp-muted pad">Nothing mounted.</p>
      <FsTreeNode v-for="n in rootChildren" :key="n.path" :node="n" :depth="0" />
    </div>
  </div>
</template>

<style scoped>
.filter {
  margin-bottom: 8px;
}

.tree {
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius-sm);
  max-height: 16rem;
  overflow-y: auto;
  padding: 4px;
}

.tree .pad {
  padding: 8px;
  margin: 0;
}
</style>
