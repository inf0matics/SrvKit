<script setup lang="ts">
import type { HostMetric } from '~/composables/useHost'

definePageMeta({ middleware: 'auth', layout: 'shell' })
usePageTitle('Host monitoring')

const { metrics, mounts, refresh, saveMetric } = useHost()

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  refresh()
  timer = setInterval(refresh, 60_000) // poll interval: 60s
})
onBeforeUnmount(() => clearInterval(timer))

// One section per category (stable order). Each carries its metrics plus any
// missing mounts gating that category, so the warning sits before its section.
const ORDER = ['CPU', 'Memory', 'Disk', 'Network', 'System']
const sections = computed(() =>
  ORDER.map((cat) => {
    const missing = mounts.value.filter((mt) => !mt.present && mt.section === cat)
    return {
      cat,
      rows: metrics.value.filter((m) => m.category === cat),
      missing,
      // A purely-optional gap reads as "enable extra metrics", not an error.
      optionalOnly: missing.length > 0 && missing.every((m) => m.optional),
    }
  }).filter((s) => s.rows.length || s.missing.length),
)

const STATUS_LABEL: Record<string, string> = {
  ok: 'OK',
  warn: 'WARN',
  crit: 'CRIT',
  na: 'not available',
  info: 'info only',
  off: 'disabled',
}

// Inline threshold editor.
const editingId = ref<string | null>(null)
const draft = reactive({ warn: 0, crit: 0 })
function openEditor(m: HostMetric) {
  editingId.value = m.id
  draft.warn = m.warn ?? 0
  draft.crit = m.crit ?? 0
}
async function saveThresholds(m: HostMetric) {
  await saveMetric(m.id, { warn: Number(draft.warn), crit: Number(draft.crit) })
  editingId.value = null
}
async function toggle(m: HostMetric) {
  m.enabled = !m.enabled // optimistic so the switch reflects the click immediately
  await saveMetric(m.id, { enabled: m.enabled })
}

// Comparator shown for thresholds: '>' for higher-is-worse, '<' for lower (inodes).
const cmp = (m: HostMetric) => (m.dir === 'low' ? '<' : '>')
</script>

<template>
  <div class="page" data-testid="host">
    <header class="page-head">
      <h1>Host monitoring</h1>
    </header>

    <template v-for="s in sections" :key="s.cat">
      <section
        v-if="s.missing.length"
        class="warn-box"
        :class="{ optional: s.optionalOnly }"
        :data-testid="`missing-${s.cat}`"
      >
        <strong v-if="s.optionalOnly">
          ℹ️ {{ s.cat }} metrics are optional.
        </strong>
        <strong v-else>⚠️ {{ s.cat }} metrics need a volume mount.</strong>
        {{
          s.optionalOnly
            ? 'They need the host filesystem mounted (broad, read-only access — only add it if you want these). In your'
            : 'Add to your'
        }}
        <code>docker-compose.yml</code> and restart:
        <pre>volumes:
<template v-for="m in s.missing" :key="m.path">  {{ m.compose }}
</template></pre>
      </section>

      <section v-if="s.rows.length" class="card">
        <h2>{{ s.cat }}</h2>
        <div v-for="m in s.rows" :key="m.id" class="metric" :data-testid="`metric-${m.id}`">
        <div class="metric-row">
          <span class="m-name">{{ m.name }}</span>
          <span class="m-value" :data-testid="`value-${m.id}`">{{ m.display }}</span>

          <span v-if="!m.informational && m.warn !== null" class="m-thresholds tsp-muted">
            <span class="thr-warn">WARN {{ cmp(m) }}{{ m.warn }}{{ m.unit }}</span>
            <span class="thr-crit">CRIT {{ cmp(m) }}{{ m.crit }}{{ m.unit }}</span>
          </span>
          <span v-else class="m-thresholds" />

          <button
            v-if="!m.informational"
            class="tsp-btn tsp-btn-sm tsp-btn-icon"
            :aria-label="`Edit ${m.name} thresholds`"
            :data-testid="`edit-${m.id}`"
            @click="editingId === m.id ? (editingId = null) : openEditor(m)"
          >
            <AppIcon name="pencil" />
          </button>

          <span class="badge" :class="`st-${m.status}`" :data-testid="`status-${m.id}`">
            {{ STATUS_LABEL[m.status] }}
            <template v-if="m.note"> · {{ m.note }}</template>
          </span>

          <label
            v-if="!m.informational"
            class="switch"
            :title="m.enabled ? 'Enabled' : 'Disabled'"
            :data-testid="`toggle-${m.id}`"
          >
            <input
              type="checkbox"
              :checked="m.enabled"
              :aria-label="`Enable ${m.name}`"
              @change="toggle(m)"
            >
            <span class="track"><span class="thumb" /></span>
          </label>
          <span v-else class="switch-spacer" />
        </div>

        <div v-if="editingId === m.id" class="editor" :data-testid="`editor-${m.id}`">
          <label>WARN {{ cmp(m) }} <input v-model.number="draft.warn" type="number" class="tsp-input num"> {{ m.unit }}</label>
          <label>CRIT {{ cmp(m) }} <input v-model.number="draft.crit" type="number" class="tsp-input num"> {{ m.unit }}</label>
          <button class="tsp-btn tsp-btn-sm tsp-btn-primary" @click="saveThresholds(m)">Save</button>
          <button class="tsp-btn tsp-btn-sm" @click="editingId = null">Cancel</button>
        </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page {
  max-width: 820px;
  margin: 0 auto;
  padding: 40px 24px 64px;
}

.page-head h1 {
  margin: 0 0 8px;
  font-size: 1.6rem;
}

.warn-box {
  border: 1px solid var(--tsp-primary);
  border-radius: var(--tsp-radius);
  background: var(--tsp-surface);
  padding: 14px 16px;
  margin: 16px 0;
  font-size: 0.9rem;
}

/* Optional mounts are informational, not an error — use a neutral border. */
.warn-box.optional {
  border-color: var(--tsp-border);
  color: var(--tsp-text-muted);
}

.warn-box pre,
.warn-box code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.8rem;
}

.warn-box pre {
  margin: 8px 0 0;
  white-space: pre-wrap;
}

.card {
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius);
  background: var(--tsp-surface);
  padding: 14px 18px;
  margin-top: 16px;
}

.card h2 {
  margin: 0 0 8px;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--tsp-text-muted);
}

.metric {
  border-top: 1px solid var(--tsp-border);
  padding: 8px 0;
}

.metric:first-of-type {
  border-top: none;
}

.metric-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.m-name {
  font-weight: 600;
  min-width: 11rem;
}

.m-value {
  min-width: 5rem;
  font-variant-numeric: tabular-nums;
}

.m-thresholds {
  flex: 1;
  display: flex;
  gap: 12px;
  font-size: 0.8rem;
}

.thr-warn {
  color: var(--tsp-warn, #d9a514);
}

.thr-crit {
  color: var(--tsp-danger);
}

.badge {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
}

.st-ok {
  background: rgba(63, 185, 80, 0.15);
  color: var(--tsp-success, #3fb950);
}

.st-warn {
  background: rgba(217, 165, 20, 0.18);
  color: var(--tsp-warn, #d9a514);
}

.st-crit {
  background: rgba(255, 99, 71, 0.18);
  color: var(--tsp-danger);
}

.st-na,
.st-info,
.st-off {
  background: var(--tsp-bg);
  color: var(--tsp-text-muted);
  font-weight: 600;
}

.editor {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0 4px 11rem;
  font-size: 0.85rem;
}

.editor label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--tsp-text-muted);
}

.num {
  width: 5rem;
}

/* On/off switch */
.switch {
  position: relative;
  display: inline-flex;
  cursor: pointer;
  flex-shrink: 0;
}

.switch input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.track {
  width: 38px;
  height: 22px;
  border-radius: 999px;
  background: var(--tsp-border);
  display: inline-flex;
  align-items: center;
  padding: 2px;
  transition: background 0.15s ease;
}

.thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--tsp-surface);
  transition: transform 0.15s ease;
}

.switch input:checked + .track {
  background: var(--tsp-primary);
}

.switch input:checked + .track .thumb {
  transform: translateX(16px);
}

.switch-spacer {
  width: 38px;
  flex-shrink: 0;
}
</style>
