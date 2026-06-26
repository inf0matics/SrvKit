<script setup lang="ts">
import { lazyTreeKey, type ChildNode } from '~/utils/lazyTree'

const props = withDefaults(defineProps<{ node: ChildNode; depth?: number }>(), {
  depth: 0,
})

const ctrl = inject(lazyTreeKey)!
const isDir = computed(() => props.node.type === 'dir')

function onName() {
  if (isDir.value) ctrl.toggleExpand(props.node)
  else if (ctrl.mode === 'pick') ctrl.selectFile(props.node)
}
</script>

<template>
  <div v-if="ctrl.matches(node)" class="lt">
    <div
      class="row"
      :class="{ sel: ctrl.mode === 'pick' && ctrl.isSelected(node) }"
      :style="{ paddingLeft: 6 + depth * 16 + 'px' }"
    >
      <button
        v-if="isDir && node.hasChildren"
        class="arrow"
        :aria-label="ctrl.isExpanded(node.path) ? 'Collapse' : 'Expand'"
        @click="ctrl.toggleExpand(node)"
      >
        <span v-if="ctrl.isLoading(node.path)" class="spinner" />
        <span v-else>{{ ctrl.isExpanded(node.path) ? '▾' : '▸' }}</span>
      </button>
      <span v-else class="arrow-spacer" />

      <input
        v-if="ctrl.mode === 'checkbox'"
        type="checkbox"
        :checked="ctrl.isChecked(node)"
        :disabled="ctrl.isDisabled(node)"
        @change="ctrl.toggleCheck(node)"
      >

      <AppIcon :name="isDir ? 'folder' : 'tag'" />
      <button class="name" @click="onName">{{ node.name }}</button>
    </div>

    <template v-if="isDir && ctrl.isExpanded(node.path)">
      <FsTreeNode
        v-for="c in ctrl.childrenOf(node.path)"
        :key="c.path"
        :node="c"
        :depth="depth + 1"
      />
    </template>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: var(--tsp-radius-sm);
  font-size: 0.9rem;
}

.row.sel {
  background: var(--tsp-primary);
  color: var(--tsp-on-primary);
}

.row:not(.sel):hover {
  background: var(--tsp-bg);
}

.arrow,
.arrow-spacer {
  width: 16px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.arrow {
  background: none;
  border: none;
  color: var(--tsp-text-muted);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}

.name {
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spinner {
  width: 11px;
  height: 11px;
  border: 2px solid var(--tsp-border);
  border-top-color: var(--tsp-primary);
  border-radius: 50%;
  display: inline-block;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
