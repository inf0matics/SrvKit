<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'shell' })
usePageTitle('Peers')

const {
  peers,
  pending,
  outgoing,
  timing,
  ipAllowlist,
  refresh,
  connect,
  pair,
  removePeer,
  removeOutgoing,
  setTiming,
  setSecurity,
} = usePeers()

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  refresh()
  timer = setInterval(refresh, 10_000) // poll for pings + pending keys
})
onBeforeUnmount(() => clearInterval(timer))

// Outgoing pairing flow (this instance connecting to another).
const domain = ref('')
const key = ref('')
const step = ref<'idle' | 'key'>('idle')
const busy = ref(false)
const error = ref('')

function errMsg(e: unknown): string {
  return apiErrorMessage(e, (e as { message?: string })?.message || 'Something went wrong')
}

async function onConnect() {
  error.value = ''
  busy.value = true
  try {
    domain.value = await connect(domain.value)
    step.value = 'key'
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

async function onConfirm() {
  error.value = ''
  busy.value = true
  try {
    await pair(domain.value, key.value)
    step.value = 'idle'
    domain.value = ''
    key.value = ''
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

function cancelPairing() {
  step.value = 'idle'
  key.value = ''
  error.value = ''
}

// Pending registration box (this instance was probed by another).
const copied = ref(false)
async function copyKey() {
  if (!pending.value) return
  try {
    await navigator.clipboard.writeText(pending.value.key)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* clipboard unavailable — the key is visible to copy by hand */
  }
}

// The intervals worth offering. Any value the server accepts (30..3600 s) still
// works — an ENV-set one is added to the list below rather than dropped.
const INTERVAL_CHOICES = [
  { value: 60, label: '1 min' },
  { value: 120, label: '2 min' },
  { value: 300, label: '5 min' },
  { value: 600, label: '10 min' },
  { value: 900, label: '15 min' },
]

/** An interval set via ENV need not be one of the offered choices. */
const intervalChoices = computed(() => {
  const current = timing.value?.intervalSec
  if (!current || INTERVAL_CHOICES.some((o) => o.value === current)) return INTERVAL_CHOICES
  return [...INTERVAL_CHOICES, { value: current, label: `${current} s` }].sort(
    (a, b) => a.value - b.value,
  )
})

// Local edit state for the two fields. Binding them straight to `timing` would
// let a re-render — a save of the other field, or the 10s poll — reset the DOM
// value under the cursor, because Vue re-applies a `value` prop whenever it
// differs from what is in the input.
const intervalInput = ref(0)
const thresholdInput = ref(0)

// Follow the server per field, and only when that field's stored value actually
// changed: the first load, and a value the server clamped. Watching both
// together would make saving one field reset the other mid-edit, and the 10s
// poll re-applies an unchanged value on every tick.
watch(
  () => timing.value?.intervalSec,
  (sec) => {
    if (sec) intervalInput.value = sec
  },
  { immediate: true },
)
watch(
  () => timing.value?.missThreshold,
  (n) => {
    if (n) thresholdInput.value = n
  },
  { immediate: true },
)

const timingSummary = computed(() => {
  if (!timing.value) return ''
  const { missThreshold, windowMs } = timing.value
  const mins = Math.round(windowMs / 60_000)
  const beats = missThreshold === 1 ? 'heartbeat' : 'heartbeats'
  return `Alerts after ${missThreshold} missed ${beats} — about ${mins} min of silence. A peer that reports its own interval is judged by that instead.`
})

function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ago`
}
function expiresInMin(expiresAt: number): number {
  return Math.max(0, Math.round((expiresAt - Date.now()) / 60_000))
}
async function onInterval() {
  await setTiming({ intervalSec: intervalInput.value })
}

/** The server clamps; the watch above writes the accepted value back into the field. */
async function onThreshold() {
  await setTiming({ missThreshold: thresholdInput.value })
}

function outgoingStatusText(o: { lastSentAt: number | null; ok: boolean | null }): string {
  if (o.lastSentAt === null) return 'not sent yet'
  return o.ok ? `✓ last sent ${fmtAgo(Date.now() - o.lastSentAt)}` : '✗ last send failed'
}
</script>

<template>
  <div class="page" data-testid="peers">
    <header class="page-head">
      <h1>Peers</h1>
    </header>

    <section v-if="pending" class="pair-box" data-testid="pending-box">
      <strong>⚡ A new SrvKit is trying to connect</strong>
      <p>Copy this key and enter it on the other SrvKit:</p>
      <div class="key-display">
        <code data-testid="pending-key">{{ pending.key }}</code>
        <button class="tsp-btn tsp-btn-sm" data-testid="copy-key" @click="copyKey">
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <p class="muted">This key expires in {{ expiresInMin(pending.expiresAt) }} minutes.</p>
    </section>

    <section v-if="!outgoing" class="card">
      <h2>Connect to a peer SrvKit</h2>
      <div v-if="step === 'idle'" class="form-row">
        <input
          v-model="domain"
          class="tsp-input"
          placeholder="https://srvkit.server2.example.com"
          data-testid="peer-domain"
          @keyup.enter="onConnect"
        >
        <button
          class="tsp-btn tsp-btn-primary"
          :disabled="busy || !domain"
          data-testid="connect"
          @click="onConnect"
        >
          Connect
        </button>
      </div>
      <template v-else>
        <p class="muted">
          Domain confirmed. Go to the other SrvKit's Peers page and copy the key shown there.
        </p>
        <div class="form-row">
          <input
            v-model="key"
            class="tsp-input"
            placeholder="A3F7-KP92"
            data-testid="peer-key"
            @keyup.enter="onConfirm"
          >
          <button
            class="tsp-btn tsp-btn-primary"
            :disabled="busy || !key"
            data-testid="confirm"
            @click="onConfirm"
          >
            Confirm
          </button>
          <button class="tsp-btn" @click="cancelPairing">Cancel</button>
        </div>
      </template>
      <p v-if="error" class="error" data-testid="peer-error">{{ error }}</p>
    </section>

    <section class="card">
      <h2>Monitored peers</h2>
      <p v-if="!peers.length" class="muted" data-testid="no-peers">No peers registered.</p>
      <div v-for="p in peers" :key="p.id" class="peer-row" :data-testid="`peer-${p.id}`">
        <span class="peer-name">{{ p.name }}</span>
        <span
          class="badge"
          :class="p.status === 'crit' ? 'st-crit' : 'st-ok'"
          :data-testid="`peer-status-${p.id}`"
        >
          {{ p.status === 'crit' ? 'CRIT' : 'OK' }}
        </span>
        <span class="peer-seen">last seen {{ fmtAgo(p.lastSeenAgoMs) }}</span>
        <button
          class="tsp-btn tsp-btn-sm tsp-btn-icon"
          :aria-label="`Remove ${p.name}`"
          :data-testid="`remove-peer-${p.id}`"
          @click="removePeer(p.id)"
        >
          <AppIcon name="trash" />
        </button>
      </div>
    </section>

    <section v-if="timing" class="card" data-testid="timing">
      <h2>Heartbeat timing</h2>
      <div class="timing-row">
        <label for="hb-interval">Send interval</label>
        <select
          id="hb-interval"
          v-model.number="intervalInput"
          class="tsp-input"
          data-testid="hb-interval"
          @change="onInterval"
        >
          <option v-for="o in intervalChoices" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </select>
      </div>
      <div class="timing-row">
        <label for="hb-threshold">Alert after</label>
        <input
          id="hb-threshold"
          v-model.number="thresholdInput"
          class="tsp-input narrow"
          type="number"
          min="1"
          max="10"
          data-testid="hb-threshold"
          @change="onThreshold"
          @keyup.enter="onThreshold"
        >
        <span class="muted">missed heartbeats</span>
      </div>
      <p class="muted" data-testid="hb-summary">{{ timingSummary }}</p>
    </section>

    <section class="card" data-testid="security">
      <h2>Security</h2>
      <div class="sec-row">
        <label class="switch" data-testid="ip-allowlist-toggle">
          <input
            type="checkbox"
            :checked="ipAllowlist"
            aria-label="Restrict pings to known peer IPs"
            @change="setSecurity(!ipAllowlist)"
          >
          <span class="track"><span class="thumb" /></span>
        </label>
        <span class="sec-text">
          <strong>Restrict pings to known peer IPs</strong>
          <span class="muted">
            Only accept pings from the IP address recorded during pairing. If a peer's IP changes
            (dynamic IP / NAT), remove and re-pair it.
          </span>
        </span>
      </div>
    </section>

    <section v-if="outgoing" class="card" data-testid="outgoing">
      <h2>Outgoing heartbeat</h2>
      <div class="out-row">
        <div>
          <div>Sending to: <code>{{ outgoing.domain }}</code></div>
          <div class="muted">Status: {{ outgoingStatusText(outgoing) }}</div>
        </div>
        <button class="tsp-btn tsp-btn-sm" data-testid="remove-outgoing" @click="removeOutgoing()">
          Remove
        </button>
      </div>
    </section>

    <section class="info-box" data-testid="peers-info">
      <strong>ℹ️ How peer heartbeat works</strong>
      <p>
        Two SrvKit instances watch each other by exchanging periodic pings. Because the
        <em>receiver</em> detects the silence, an alert still fires even when the other server is
        completely down.
      </p>
      <p>
        <strong>Pairing.</strong> Enter the other SrvKit's domain and hit Connect — it shows a
        one-time key (valid 10&nbsp;minutes). Copy that key back here and Confirm. From then on this
        instance sends a heartbeat to that server on the interval set above; the key is discarded
        and pings use a permanent token.
      </p>
      <p>
        <strong>Monitored peers</strong> are the servers that ping <em>this</em> one — once a peer
        misses the configured number of heartbeats in a row, this instance sends an alert, and a
        recovery when it returns (threaded under the alert where the channel supports replies).
        Each heartbeat carries the sender's own interval, so a peer pinging more often is noticed
        sooner. <strong>Outgoing heartbeat</strong> is where this server sends its own ping, so the
        peer can alert on <em>your</em> downtime.
      </p>
      <p>
        Pairing sets up <strong>one direction</strong> (the peer watches you). For mutual
        monitoring, pair the other way too. Alerts go out over your configured
        <NuxtLink to="/app/alerts">alert channels</NuxtLink>.
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

.page-head h1 {
  margin: 0 0 8px;
  font-size: 1.6rem;
}

.card {
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius);
  background: var(--tsp-surface);
  padding: 14px 18px;
  margin-top: 16px;
}

.card h2 {
  margin: 0 0 12px;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--tsp-text-muted);
}

.pair-box {
  border: 1px solid var(--tsp-primary);
  border-radius: var(--tsp-radius);
  background: var(--tsp-surface);
  padding: 14px 18px;
  margin-top: 16px;
}

.pair-box p {
  margin: 6px 0;
  font-size: 0.9rem;
}

.key-display {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 10px 0;
}

.key-display code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 1.4rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--tsp-primary);
}

.form-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.form-row .tsp-input {
  flex: 1;
}

.muted {
  color: var(--tsp-text-muted);
  font-size: 0.85rem;
}

.error {
  color: var(--tsp-danger);
  font-size: 0.85rem;
  margin: 10px 0 0;
}

.peer-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid var(--tsp-border);
}

.peer-row:first-of-type {
  border-top: none;
}

.peer-name {
  font-weight: 600;
  min-width: 12rem;
}

.peer-seen {
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

.st-crit {
  background: rgba(255, 99, 71, 0.18);
  color: var(--tsp-danger);
}

.out-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.9rem;
}

.out-row code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
}

.timing-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  font-size: 0.9rem;
}

.timing-row label {
  min-width: 8rem;
}

.timing-row .tsp-input {
  max-width: 10rem;
}

.timing-row .narrow {
  max-width: 5rem;
}

.sec-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.sec-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.9rem;
}

/* On/off switch */
.switch {
  position: relative;
  display: inline-flex;
  cursor: pointer;
  flex-shrink: 0;
  margin-top: 1px;
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

.info-box {
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius);
  background: var(--tsp-surface);
  padding: 14px 18px;
  margin-top: 16px;
  font-size: 0.82rem;
  color: var(--tsp-text-muted);
}

.info-box p {
  margin: 8px 0 0;
  line-height: 1.5;
}

.info-box a {
  color: var(--tsp-primary);
}
</style>
