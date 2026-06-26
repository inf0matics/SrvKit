<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'shell' })

interface TelegramSettings {
  chatId: string
  enabled: boolean
  hasToken: boolean
  recovery: boolean
}

const { jobs: mutedJobs, refresh: refreshMuted } = useMutedJobs()

const form = reactive({ token: '', chatId: '', enabled: false, recovery: true })
const hasToken = ref(false)
const loaded = ref(false)

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
  loaded.value = true
}

onMounted(() => {
  load()
  refreshMuted()
})

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

async function unmute(id: string) {
  await $fetch(`/api/backups/jobs/${id}/mute`, { method: 'POST', body: { muted: false } })
  await refreshMuted()
}
</script>

<template>
  <div class="page" data-testid="settings">
    <header class="page-head">
      <h1>Settings</h1>
    </header>

    <section class="card" data-testid="alerts-section">
      <h2>Alerts</h2>
      <p class="tsp-muted intro">
        Backup jobs alert all active channels when a run fails, and again when the
        next run recovers.
      </p>

      <h3>Telegram</h3>
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
        <input v-model="form.enabled" type="checkbox">
        <span>Enable Telegram alerts</span>
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

    <section class="card" data-testid="muted-section">
      <h2>Muted jobs</h2>
      <p v-if="!mutedJobs.length" class="tsp-muted">No jobs are muted.</p>
      <div v-else class="muted-list">
        <div v-for="j in mutedJobs" :key="j.id" class="muted-row" data-testid="muted-row">
          <AppIcon :name="j.type === 'sqlite' ? 'database-export' : 'folder'" />
          <div class="muted-meta">
            <span class="muted-name">{{ j.name }}</span>
            <span class="muted-target tsp-muted">{{ j.targetName }}</span>
          </div>
          <button class="tsp-btn tsp-btn-sm" @click="unmute(j.id)">Unmute</button>
        </div>
      </div>
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

.card {
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius);
  background: var(--tsp-surface);
  padding: 20px 22px;
  margin-top: 16px;
}

.card h2 {
  margin: 0 0 4px;
  font-size: 1.15rem;
}

.card h3 {
  margin: 18px 0 10px;
  font-size: 0.95rem;
  color: var(--tsp-text-muted);
}

.intro {
  margin: 0 0 4px;
  font-size: 0.9rem;
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

.muted-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.muted-row {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius-sm);
  padding: 10px 12px;
}

.muted-meta {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.muted-name {
  font-weight: 600;
}

.muted-target {
  font-size: 0.82rem;
}
</style>
