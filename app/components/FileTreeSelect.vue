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

// Selected paths that no longer exist on disk (e.g. a file that was renamed).
// They never appear in the tree, so we surface them separately with a deselect.
const missing = ref<string[]>([])

async function checkMissing() {
  if (!included.value.size) {
    missing.value = []
    return
  }
  try {
    const { missing: m } = await $fetch<{ missing: string[] }>('/api/fs/missing', {
      method: 'POST',
      body: { sourcePath: props.sourcePath, includes: [...included.value] },
    })
    missing.value = m
  } catch {
    missing.value = []
  }
}

function removeMissing(rel: string) {
  const next = new Set(included.value)
  next.delete(rel)
  included.value = next
  missing.value = missing.value.filter((p) => p !== rel)
  emit('update:modelValue', [...next])
}

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
  await checkMissing()
})

watch(
  () => props.sourcePath,
  async () => {
    cache.clear()
    expanded.clear()
    included.value = new Set()
    missing.value = []
    emit('update:modelValue', [])
    await load(props.sourcePath)
  },
)
</script>

<template>
  <div>
    <div v-if="missing.length" class="missing" data-testid="missing-includes">
      <p class="missing-head">
        ⚠️ Selected but no longer on disk — deselect to stop the backup from failing:
      </p>
      <div v-for="m in missing" :key="m" class="missing-row" data-testid="missing-row">
        <code class="missing-path">{{ m }}</code>
        <button
          type="button"
          class="tsp-btn tsp-btn-sm tsp-btn-icon"
          :aria-label="`Deselect ${m}`"
          @click="removeMissing(m)"
        >
          <AppIcon name="trash" />
        </button>
      </div>
    </div>

    <div class="tree">
      <p v-if="loading.has(sourcePath) && !cache.has(sourcePath)" class="tsp-muted pad">
        Loading…
      </p>
      <p v-else-if="!rootChildren.length" class="tsp-muted pad">
        This directory is empty.
      </p>
      <FsTreeNode v-for="n in rootChildren" :key="n.path" :node="n" :depth="0" />
    </div>
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

.missing {
  border: 1px solid var(--tsp-danger);
  border-radius: var(--tsp-radius-sm);
  background: rgba(255, 99, 71, 0.08);
  padding: 8px 10px;
  margin-bottom: 8px;
}

.missing-head {
  margin: 0 0 6px;
  font-size: 0.8rem;
  color: var(--tsp-danger);
}

.missing-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}

.missing-path {
  flex: 1;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.8rem;
  color: var(--tsp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
