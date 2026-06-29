<script setup lang="ts">
import type { DockerContainer } from '~/composables/useDocker'

definePageMeta({ middleware: 'auth', layout: 'shell' })
usePageTitle('Docker')

const { containers, available, counts, countEnabled, refresh, save, setAll, setCount, remove } =
  useDocker()

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  refresh()
  timer = setInterval(refresh, 10_000) // poll interval: 10s
})
onBeforeUnmount(() => clearInterval(timer))

const STATUS_LABEL: Record<string, string> = { ok: 'OK', warn: 'WARN', crit: 'CRIT' }

function fmtAgo(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`
}
function timing(c: DockerContainer): string {
  return c.offlineFor === null
    ? `last checked ${fmtAgo(c.lastCheckedAgo)} ago`
    : `offline for ${fmtAgo(c.offlineFor)}`
}

async function toggle(c: DockerContainer) {
  c.enabled = !c.enabled // optimistic
  await save(c.name, { enabled: c.enabled })
}

async function toggleCount() {
  await setCount(!countEnabled.value)
}

// Inline grace-period editor.
const editingName = ref<string | null>(null)
const draftGrace = ref(30)
function openEditor(c: DockerContainer) {
  editingName.value = c.name
  draftGrace.value = c.grace
}
async function saveGrace(c: DockerContainer) {
  await save(c.name, { grace: Number(draftGrace.value) })
  editingName.value = null
}
</script>

<template>
  <div class="page" data-testid="docker">
    <header class="page-head">
      <h1>Docker</h1>
    </header>

    <section v-if="!available" class="warn-box" data-testid="docker-missing">
      <strong>⚠️ Docker socket not mounted.</strong>
      Docker monitoring requires <code>/var/run/docker.sock</code> to be mounted into SrvKit.
      Add to your <code>docker-compose.yml</code> and restart:
      <pre>volumes:
  - /var/run/docker.sock:/var/run/docker.sock</pre>
    </section>

    <template v-else>
      <section class="card summary" data-testid="count-summary">
        <div class="summary-row">
          <span class="c-name">Containers</span>
          <span class="counts">
            <span data-testid="count-running">running {{ counts.running }}</span>
            <span data-testid="count-exited"><em>exited</em> {{ counts.exited }}</span>
            <span><em>paused</em> {{ counts.paused }}</span>
            <span><em>dead</em> {{ counts.dead }}</span>
          </span>
          <label
            class="switch"
            :title="countEnabled ? 'Count-change alerts on' : 'Count-change alerts off'"
            data-testid="count-toggle"
          >
            <input
              type="checkbox"
              :checked="countEnabled"
              aria-label="Alert on container count change"
              @change="toggleCount"
            >
            <span class="track"><span class="thumb" /></span>
          </label>
        </div>
        <p class="summary-hint">
          <span class="hint-icon" aria-hidden="true">ℹ️</span>
          When enabled, sends an alert whenever the number of <strong>running</strong> containers
          changes — any container starting, stopping, or crashing on the host, whether or not it's
          individually monitored below. The message lists the current
          running/exited/paused/dead counts.
        </p>
      </section>

      <div class="toolbar">
        <button class="tsp-btn tsp-btn-sm" data-testid="enable-all" @click="setAll(true)">
          Enable All
        </button>
        <button class="tsp-btn tsp-btn-sm" data-testid="disable-all" @click="setAll(false)">
          Disable All
        </button>
      </div>

      <section class="card">
        <p v-if="!containers.length" class="empty" data-testid="docker-empty">
          No containers discovered.
        </p>
        <div
          v-for="c in containers"
          :key="c.name"
          class="metric"
          :data-testid="`container-${c.name}`"
        >
          <div class="metric-row" :class="{ disabled: !c.enabled }">
            <label
              v-if="!c.removed"
              class="switch"
              :title="c.enabled ? 'Monitored' : 'Not monitored'"
              :data-testid="`toggle-${c.name}`"
            >
              <input
                type="checkbox"
                :checked="c.enabled"
                :aria-label="`Monitor ${c.name}`"
                @change="toggle(c)"
              >
              <span class="track"><span class="thumb" /></span>
            </label>
            <span v-else class="switch-spacer" />

            <span class="c-name">{{ c.name }}</span>

            <span
              v-if="c.status === 'pending'"
              class="badge pending"
              :class="`st-${c.pendingLevel}`"
              :data-testid="`status-${c.name}`"
            >
              {{ c.pendingLevel?.toUpperCase() }} pending
            </span>
            <span
              v-else-if="c.status !== 'off'"
              class="badge"
              :class="`st-${c.status}`"
              :data-testid="`status-${c.name}`"
            >
              {{ STATUS_LABEL[c.status] }}
            </span>

            <span class="c-state" :data-testid="`state-${c.name}`">{{ c.state }}</span>
            <span class="c-timing">{{ c.removed ? 'removed from Docker' : timing(c) }}</span>

            <button
              v-if="c.removed"
              class="tsp-btn tsp-btn-sm tsp-btn-icon"
              :aria-label="`Remove ${c.name} from the list`"
              :data-testid="`remove-${c.name}`"
              @click="remove(c.name)"
            >
              <AppIcon name="trash" />
            </button>
            <button
              v-else
              class="tsp-btn tsp-btn-sm tsp-btn-icon"
              :aria-label="`Edit ${c.name} grace period`"
              :data-testid="`edit-${c.name}`"
              @click="editingName === c.name ? (editingName = null) : openEditor(c)"
            >
              <AppIcon name="pencil" />
            </button>
          </div>

          <div
            v-if="!c.removed && editingName === c.name"
            class="editor"
            :data-testid="`editor-${c.name}`"
          >
            <label>
              Grace period
              <input v-model.number="draftGrace" type="number" min="10" class="tsp-input num">
              seconds
            </label>
            <button class="tsp-btn tsp-btn-sm tsp-btn-primary" @click="saveGrace(c)">Save</button>
            <button class="tsp-btn tsp-btn-sm" @click="editingName = null">Cancel</button>
          </div>
        </div>
      </section>

      <section class="info-box" data-testid="docker-info">
        <strong>ℹ️ How outage detection works</strong>
        <p>
          SrvKit polls every 10&nbsp;seconds and only sees containers that still exist. A
          monitored container that is <strong>stopped or crashes</strong> (state
          <code>exited</code> or <code>dead</code>) starts its grace period and then alerts
          <code>CRIT</code>. Recovery to <code>running</code> clears the alert silently. The grace
          clock is read from Docker's exit time, so it survives a SrvKit restart.
        </p>
        <p>
          A <strong>monitored</strong> container that is <strong>removed</strong> — e.g.
          <code>docker compose down</code> or <code>docker rm</code> — goes <code>CRIT</code>
          immediately and stays in the list as <code>removed</code> until you clear it with the
          trash icon. A removed container that wasn't monitored just drops off the list. New
          containers are discovered automatically (disabled by default), and per-container settings
          are remembered by name across recreate.
        </p>
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

.warn-box pre,
.warn-box code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.8rem;
}

.warn-box pre {
  margin: 8px 0 0;
  white-space: pre-wrap;
}

.toolbar {
  display: flex;
  gap: 8px;
  margin: 16px 0 0;
}

.summary {
  padding: 12px 18px;
}

.summary-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.summary-hint {
  margin: 8px 0 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--tsp-text-muted);
}

.summary-hint .hint-icon {
  margin-right: 4px;
}

.summary .counts {
  flex: 1;
  display: flex;
  gap: 16px;
  font-size: 0.85rem;
  color: var(--tsp-text-muted);
  font-variant-numeric: tabular-nums;
}

.switch-spacer {
  width: 38px;
  flex-shrink: 0;
}

.info-box {
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius);
  background: var(--tsp-surface);
  padding: 14px 16px;
  margin-top: 16px;
  font-size: 0.85rem;
  color: var(--tsp-text-muted);
}

.info-box p {
  margin: 8px 0 0;
  line-height: 1.5;
}

.info-box code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.78rem;
}

.card {
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius);
  background: var(--tsp-surface);
  padding: 6px 18px;
  margin-top: 16px;
}

.empty {
  color: var(--tsp-text-muted);
  padding: 12px 0;
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

.metric-row.disabled .c-name,
.metric-row.disabled .c-state,
.metric-row.disabled .c-timing {
  opacity: 0.45;
}

.c-name {
  font-weight: 600;
  min-width: 12rem;
}

.c-state {
  font-size: 0.8rem;
  color: var(--tsp-text-muted);
  font-variant-numeric: tabular-nums;
}

.c-timing {
  flex: 1;
  text-align: right;
  font-size: 0.8rem;
  color: var(--tsp-text-muted);
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

.badge.pending {
  background: transparent;
  border: 1px solid currentColor;
}

.editor {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 0 4px 3.4rem;
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
</style>
