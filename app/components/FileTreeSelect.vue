<script setup lang="ts">
import {
  lazyTreeKey,
  fetchChildren,
  type ChildNode,
  type LazyTreeController,
} from '~/utils/lazyTree'

// `sourcePath` is the base-relative source dir (e.g. 'root'); the v-model
// excludes are stored relative to that source dir (e.g. 'configs/app.conf').
const props = defineProps<{ sourcePath: string; modelValue: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [string[]] }>()

const cache = reactive(new Map<string, ChildNode[]>())
const expanded = reactive(new Set<string>())
const loading = reactive(new Set<string>())
const excluded = ref(new Set(props.modelValue))

const srcRel = (basePath: string) => basePath.slice(props.sourcePath.length + 1)

function excludedByAncestor(rel: string): boolean {
  const parts = rel.split('/')
  let acc = ''
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i]!
    if (excluded.value.has(acc)) return true
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
    return !excluded.value.has(r) && !excludedByAncestor(r)
  },
  isDisabled: (node) => excludedByAncestor(srcRel(node.path)),
  toggleCheck(node) {
    const r = srcRel(node.path)
    const next = new Set(excluded.value)
    if (!next.has(r) && !excludedByAncestor(r)) {
      // Currently included → exclude it (drop now-redundant descendant excludes).
      for (const e of [...next]) if (e === r || e.startsWith(r + '/')) next.delete(e)
      next.add(r)
    } else {
      next.delete(r) // re-include
    }
    excluded.value = next
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
  // Pre-expand the folders that contain an excluded path.
  for (const ex of excluded.value) {
    const parts = ex.split('/')
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
    excluded.value = new Set()
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
