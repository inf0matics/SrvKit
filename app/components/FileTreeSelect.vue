<script setup lang="ts">
import {
  lazyTreeKey,
  fetchChildren,
  type ChildNode,
  type LazyTreeController,
} from '~/utils/lazyTree'

// `sourcePath` is the base-relative source dir (e.g. 'root'); the v-model is the
// set of selected (included) paths, relative to the source dir. Nothing is
// selected by default — the user explicitly checks what to back up.
const props = defineProps<{ sourcePath: string; modelValue: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [string[]] }>()

const cache = reactive(new Map<string, ChildNode[]>())
const expanded = reactive(new Set<string>())
const loading = reactive(new Set<string>())
const included = ref(new Set(props.modelValue))

const srcRel = (basePath: string) => basePath.slice(props.sourcePath.length + 1)

function includedByAncestor(rel: string): boolean {
  const parts = rel.split('/')
  let acc = ''
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i]!
    if (included.value.has(acc)) return true
  }
  return false
}

async function load(basePath: string) {
  if (cache.has(basePath)) return
  loading.add(basePath)
  try {
    cache.set(basePath, await fetchChildren(basePath))
  } catch {
    cache.set(basePath, [])
  } finally {
    loading.delete(basePath)
  }
}

const ctrl: LazyTreeController = {
  mode: 'checkbox',
  childrenOf: (p) => cache.get(p) ?? [],
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
  isChecked(node) {
    const r = srcRel(node.path)
    return included.value.has(r) || includedByAncestor(r)
  },
  // Selected via an ancestor folder → can't be unchecked on its own.
  isDisabled: (node) => includedByAncestor(srcRel(node.path)),
  // A folder is "partial" when it isn't fully selected but holds a selection
  // somewhere below it. Derived from the flat set, so it works while collapsed.
  isPartial(node) {
    if (node.type !== 'dir') return false
    const r = srcRel(node.path)
    if (included.value.has(r) || includedByAncestor(r)) return false
    for (const inc of included.value) {
      if (inc.startsWith(r + '/')) return true
    }
    return false
  },
  toggleCheck(node) {
    const r = srcRel(node.path)
    const next = new Set(included.value)
    if (next.has(r)) {
      // Uncheck (drop it and any now-redundant descendant selections).
      for (const e of [...next]) if (e === r || e.startsWith(r + '/')) next.delete(e)
    } else {
      // Select it (a folder selects its whole subtree → drop redundant children).
      for (const e of [...next]) if (e.startsWith(r + '/')) next.delete(e)
      next.add(r)
    }
    included.value = next
    emit('update:modelValue', [...next])
  },
  isSelected: () => false,
  selectFile: () => {},
  matches: () => true,
}
provide(lazyTreeKey, ctrl)

const rootChildren = computed(() => cache.get(props.sourcePath) ?? [])

onMounted(async () => {
  await load(props.sourcePath)
  // Pre-expand the folders that contain a selected path.
  for (const inc of included.value) {
    const parts = inc.split('/')
    let acc = props.sourcePath
    for (let i = 0; i < parts.length - 1; i++) {
      acc = `${acc}/${parts[i]}`
      await load(acc)
      expanded.add(acc)
    }
  }
})

watch(
  () => props.sourcePath,
  async () => {
    cache.clear()
    expanded.clear()
    included.value = new Set()
    emit('update:modelValue', [])
    await load(props.sourcePath)
  },
)
</script>

<template>
  <div class="tree">
    <p v-if="loading.has(sourcePath) && !cache.has(sourcePath)" class="tsp-muted pad">
      Loading…
    </p>
    <p v-else-if="!rootChildren.length" class="tsp-muted pad">
      This directory is empty.
    </p>
    <FsTreeNode v-for="n in rootChildren" :key="n.path" :node="n" :depth="0" />
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

.tree .pad {
  padding: 8px;
  margin: 0;
}
</style>
