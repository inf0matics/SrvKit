<script setup lang="ts">
import type { Ping, PingInput } from '~/composables/usePings'

definePageMeta({ middleware: 'auth', layout: 'shell' })
usePageTitle('Pings')

const { pings, refresh, add, update, remove } = usePings()

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  refresh()
  timer = setInterval(refresh, 15_000) // poll interval: 15s
})
onBeforeUnmount(() => clearInterval(timer))

// Frequency dropdown — mirrors FREQUENCY_OPTIONS in lib/ping-monitor.ts.
const FREQUENCIES = [
  { value: 60, label: '1 min' },
  { value: 300, label: '5 min' },
  { value: 900, label: '15 min' },
  { value: 1800, label: '30 min' },
  { value: 3600, label: '1 h' },
]
const freqLabel = (sec: number) => FREQUENCIES.find((f) => f.value === sec)?.label ?? `${sec}s`

const STATUS_LABEL: Record<string, string> = { ok: 'OK', crit: 'CRIT' }

function fmtAgo(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`
}

/** Right-hand result summary for a row. */
function resultText(p: Ping): string {
  if (p.status === 'off') return 'monitoring disabled'
  if (p.status === 'pending') return 'checking…'
  if (p.status === 'crit') {
    const got = p.lastCode !== null ? String(p.lastCode) : (p.lastError ?? 'no response')
    const since = p.failingSince !== null ? ` · since ${fmtAgo(p.failingSince)} ago` : ''
    return `${got}${since}`
  }
  const ago = p.lastCheckedAgo !== null ? ` · checked ${fmtAgo(p.lastCheckedAgo)} ago` : ''
  return `${p.lastCode ?? 200}${ago}`
}

async function toggle(p: Ping) {
  p.enabled = !p.enabled // optimistic
  await update(p.id, { enabled: p.enabled })
}

// --- Add / edit form ---
const formMode = ref<'add' | string | null>(null) // 'add', a ping id, or closed
const draft = reactive({ url: '', name: '', expectedStatus: 200, intervalSec: 300 })
const formError = ref('')

function openAdd() {
  formMode.value = 'add'
  formError.value = ''
  Object.assign(draft, { url: '', name: '', expectedStatus: 200, intervalSec: 300 })
}
function openEdit(p: Ping) {
  formMode.value = p.id
  formError.value = ''
  Object.assign(draft, {
    url: p.url,
    name: p.name,
    expectedStatus: p.expectedStatus,
    intervalSec: p.intervalSec,
  })
}
function closeForm() {
  formMode.value = null
}

async function submit() {
  formError.value = ''
  const payload: PingInput = {
    url: draft.url.trim(),
    name: draft.name.trim(),
    expectedStatus: Number(draft.expectedStatus),
    intervalSec: Number(draft.intervalSec),
  }
  try {
    if (formMode.value === 'add') await add(payload)
    else if (formMode.value) await update(formMode.value, payload)
    closeForm()
  } catch (e) {
    formError.value = (e as { data?: { message?: string } })?.data?.message ?? 'Could not save the ping.'
  }
}

async function del(p: Ping) {
  await remove(p.id)
  if (formMode.value === p.id) closeForm()
}
</script>

<template>
  <div class="page" data-testid="pings">
    <header class="page-head">
      <h1>Pings</h1>
      <button class="tsp-btn tsp-btn-primary tsp-btn-sm" data-testid="add-ping" @click="openAdd">
        + Add Ping
      </button>
    </header>

    <p class="lede">
      Periodically send a <code>GET</code> to each URL and alert when its response status changes.
    </p>

    <section v-if="formMode" class="card form" data-testid="ping-form">
      <h2>{{ formMode === 'add' ? 'Add ping' : 'Edit ping' }}</h2>
      <div class="fields">
        <label class="field url">
          <span>URL</span>
          <input
            v-model="draft.url"
            type="url"
            placeholder="https://example.com/health"
            class="tsp-input"
            data-testid="form-url"
          >
        </label>
        <label class="field">
          <span>Name <em>(optional)</em></span>
          <input
            v-model="draft.name"
            type="text"
            placeholder="Shown instead of the URL"
            class="tsp-input"
            data-testid="form-name"
          >
        </label>
        <label class="field">
          <span>Expected status code</span>
          <input
            v-model.number="draft.expectedStatus"
            type="number"
            min="100"
            max="599"
            class="tsp-input num"
            data-testid="form-expected"
          >
        </label>
        <label class="field">
          <span>Frequency</span>
          <select v-model.number="draft.intervalSec" class="tsp-input" data-testid="form-frequency">
            <option v-for="f in FREQUENCIES" :key="f.value" :value="f.value">{{ f.label }}</option>
          </select>
        </label>
      </div>
      <p v-if="formError" class="form-err" data-testid="form-error">{{ formError }}</p>
      <div class="form-actions">
        <button class="tsp-btn tsp-btn-primary tsp-btn-sm" data-testid="form-save" @click="submit">
          Save
        </button>
        <button class="tsp-btn tsp-btn-sm" data-testid="form-cancel" @click="closeForm">Cancel</button>
      </div>
    </section>

    <section class="card">
      <p v-if="!pings.length" class="empty" data-testid="pings-empty">No pings configured yet.</p>
      <div v-for="p in pings" :key="p.id" class="metric ping-row" data-testid="ping-row">
        <div class="metric-row" :class="{ disabled: !p.enabled }">
          <label
            class="switch"
            :title="p.enabled ? 'Monitored' : 'Not monitored'"
          >
            <input
              type="checkbox"
              :checked="p.enabled"
              :aria-label="`Enable ping ${p.name || p.url}`"
              @change="toggle(p)"
            >
            <span class="track"><span class="thumb" /></span>
          </label>

          <span class="p-name">
            <span class="p-title">{{ p.name || p.url }}</span>
            <span v-if="p.name" class="p-url">{{ p.url }}</span>
          </span>

          <span class="p-expect">expects {{ p.expectedStatus }}</span>
          <span class="p-freq">every {{ freqLabel(p.intervalSec) }}</span>

          <span
            v-if="p.status === 'ok' || p.status === 'crit'"
            class="badge"
            :class="`st-${p.status}`"
            data-testid="ping-badge"
          >
            {{ STATUS_LABEL[p.status] }}
          </span>

          <span class="p-result" data-testid="ping-result">{{ resultText(p) }}</span>

          <button
            class="tsp-btn tsp-btn-sm tsp-btn-icon"
            :aria-label="`Edit ${p.name || p.url}`"
            @click="formMode === p.id ? closeForm() : openEdit(p)"
          >
            <AppIcon name="pencil" />
          </button>
          <button
            class="tsp-btn tsp-btn-sm tsp-btn-icon"
            :aria-label="`Delete ${p.name || p.url}`"
            @click="del(p)"
          >
            <AppIcon name="trash" />
          </button>
        </div>
      </div>
    </section>

    <section class="info-box" data-testid="pings-info">
      <strong>ℹ️ How ping monitoring works</strong>
      <p>
        SrvKit sends a <code>GET</code> to each enabled URL on its frequency, following up to 5
        redirects, with a fixed 10&nbsp;second timeout. A ping is <strong>OK</strong> when the
        response matches the expected status code, and <strong>CRIT</strong> on any other code, a
        timeout, or a refused connection. Alerts fire only when the status <em>changes</em> (down or
        recovered), so a persistently failing ping never spams.
      </p>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 820px;
  margin: 0 auto;
  padding: 40px 24px 64px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.page-head h1 {
  margin: 0 0 8px;
  font-size: 1.6rem;
}

.lede {
  margin: 0 0 8px;
  color: var(--tsp-text-muted);
  font-size: 0.9rem;
}

.lede code,
.info-box code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.8rem;
}

.card {
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius);
  background: var(--tsp-surface);
  padding: 6px 18px;
  margin-top: 16px;
}

.form {
  padding: 16px 18px;
}

.form h2 {
  margin: 0 0 12px;
  font-size: 1rem;
}

.fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.85rem;
  color: var(--tsp-text-muted);
}

.field em {
  font-style: normal;
  opacity: 0.7;
}

.field.url {
  grid-column: 1 / -1;
}

.field .num {
  width: 8rem;
}

.form-err {
  margin: 10px 0 0;
  color: var(--tsp-danger);
  font-size: 0.85rem;
}

.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
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

.metric-row.disabled .p-name,
.metric-row.disabled .p-expect,
.metric-row.disabled .p-freq,
.metric-row.disabled .p-result {
  opacity: 0.45;
}

.p-name {
  display: flex;
  flex-direction: column;
  min-width: 14rem;
  overflow: hidden;
}

.p-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.p-url {
  font-size: 0.72rem;
  color: var(--tsp-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.p-expect,
.p-freq {
  font-size: 0.78rem;
  color: var(--tsp-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.p-result {
  flex: 1;
  text-align: right;
  font-size: 0.78rem;
  color: var(--tsp-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

.st-crit {
  background: rgba(255, 99, 71, 0.18);
  color: var(--tsp-danger);
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

/* On/off switch (shared visual with the Docker page) */
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
