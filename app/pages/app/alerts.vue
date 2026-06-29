<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'shell' })
usePageTitle('Alerts')

interface TelegramSettings {
  chatId: string
  enabled: boolean
  hasToken: boolean
  recovery: boolean
}

const form = reactive({ token: '', chatId: '', enabled: false, recovery: true })
const hasToken = ref(false)

const saving = ref(false)
const saveError = ref('')
const saved = ref(false)

const testing = ref(false)
const testResult = ref<{ ok: boolean; error?: string } | null>(null)

async function load() {
  const { telegram } = await $fetch<{ telegram: TelegramSettings }>('/api/settings/alerts')
  form.chatId = telegram.chatId
  form.enabled = telegram.enabled
  form.recovery = telegram.recovery
  hasToken.value = telegram.hasToken
  form.token = ''
}

onMounted(load)

async function save() {
  saving.value = true
  saveError.value = ''
  saved.value = false
  try {
    const { telegram } = await $fetch<{ telegram: TelegramSettings }>(
      '/api/settings/alerts',
      {
        method: 'PUT',
        body: {
          token: form.token, // only applied when non-empty
          chatId: form.chatId,
          enabled: form.enabled,
          recovery: form.recovery,
        },
      },
    )
    hasToken.value = telegram.hasToken
    form.token = ''
    saved.value = true
  } catch (e: unknown) {
    saveError.value = (e as { statusMessage?: string }).statusMessage || 'Could not save'
  } finally {
    saving.value = false
  }
}

// Toggling the channel on/off saves immediately so it takes effect at once.
async function onToggleEnabled() {
  await save()
}

async function test() {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await $fetch<{ ok: boolean; error?: string }>(
      '/api/settings/alerts/test',
      { method: 'POST', body: { token: form.token, chatId: form.chatId } },
    )
  } catch (e: unknown) {
    testResult.value = {
      ok: false,
      error: (e as { statusMessage?: string }).statusMessage || 'Test failed',
    }
  } finally {
    testing.value = false
  }
}

</script>

<template>
  <div class="page" data-testid="alerts">
    <header class="page-head">
      <h1>Alerts</h1>
    </header>

    <p class="tsp-muted intro">
      Backup jobs alert all active channels when a run fails, and again when the
      next run recovers.
    </p>

    <section class="card" data-testid="alerts-section">
      <div class="card-head">
        <h2>Telegram</h2>
        <label class="switch" :title="form.enabled ? 'Alerts on' : 'Alerts off'">
          <input
            v-model="form.enabled"
            type="checkbox"
            aria-label="Enable Telegram alerts"
            @change="onToggleEnabled"
          >
          <span class="track"><span class="thumb" /></span>
        </label>
      </div>
      <p class="tsp-muted card-sub">
        {{ form.enabled ? 'Enabled — failures and recoveries are sent.' : 'Disabled — no alerts are sent.' }}
      </p>

      <label class="field">
        <span>Bot token</span>
        <input
          v-model="form.token"
          class="tsp-input"
          type="password"
          autocomplete="off"
          :placeholder="hasToken ? '•••••••• (configured — leave blank to keep)' : 'Bot token'"
        >
      </label>
      <label class="field">
        <span>Chat ID</span>
        <input v-model="form.chatId" class="tsp-input" type="text" autocomplete="off">
      </label>

      <label class="field toggle">
        <input v-model="form.recovery" type="checkbox">
        <span>Send recovery notifications</span>
      </label>

      <div class="actions">
        <button
          class="tsp-btn tsp-btn-sm"
          data-testid="test-telegram"
          :disabled="testing"
          @click="test"
        >
          <AppIcon name="plug-connected" /> Test
        </button>
        <button
          class="tsp-btn tsp-btn-sm tsp-btn-primary"
          :disabled="saving"
          @click="save"
        >
          Save
        </button>
      </div>

      <p v-if="testResult?.ok" class="ok" data-testid="test-result">
        ✓ Test message sent.
      </p>
      <p v-else-if="testResult" class="err" data-testid="test-result">
        ✗ {{ testResult.error }}
      </p>
      <p v-if="saved" class="ok">✓ Saved.</p>
      <p v-if="saveError" class="err">{{ saveError }}</p>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 24px 64px;
}

.page-head h1 {
  margin: 0 0 8px;
  font-size: 1.6rem;
}

.intro {
  margin: 0 0 8px;
  font-size: 0.9rem;
}

.card {
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius);
  background: var(--tsp-surface);
  padding: 20px 22px;
  margin-top: 16px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card h2 {
  margin: 0;
  font-size: 1.15rem;
}

.card-sub {
  margin: 2px 0 14px;
  font-size: 0.85rem;
}

/* On/off switch — the input overlays the track (invisible but actionable). */
.switch {
  position: relative;
  display: inline-flex;
  cursor: pointer;
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
  width: 42px;
  height: 24px;
  border-radius: 999px;
  background: var(--tsp-border);
  display: inline-flex;
  align-items: center;
  padding: 2px;
  transition: background 0.15s ease;
}

.thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--tsp-surface);
  transition: transform 0.15s ease;
}

.switch input:checked + .track {
  background: var(--tsp-primary);
}

.switch input:checked + .track .thumb {
  transform: translateX(18px);
}

.switch input:focus-visible + .track {
  outline: 2px solid var(--tsp-primary);
  outline-offset: 2px;
}

.field {
  display: block;
  margin-bottom: 0.9rem;
}

.field > span {
  display: block;
  margin-bottom: 0.3rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--tsp-text-muted);
}

.toggle {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle span {
  margin: 0;
  color: var(--tsp-text);
  font-weight: 400;
}

.actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.ok {
  color: var(--tsp-success, #3fb950);
  font-size: 0.9rem;
}

.err {
  color: var(--tsp-danger);
  font-size: 0.9rem;
}
</style>
