<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'shell' })
usePageTitle('Alerts')

interface TelegramSettings {
  chatId: string
  enabled: boolean
  hasToken: boolean
  recovery: boolean
}
interface TalkSettings {
  url: string
  conversation: string
  enabled: boolean
  hasToken: boolean
}
type Result = { ok: boolean; error?: string } | null

const tg = reactive({ token: '', chatId: '', enabled: false, recovery: true })
const tgHasToken = ref(false)
const talk = reactive({ url: '', conversation: '', botToken: '', enabled: false })
const talkHasToken = ref(false)

const status = reactive({
  tg: { saving: false, saved: false, error: '', testing: false, test: null as Result },
  talk: { saving: false, saved: false, error: '', testing: false, test: null as Result },
})

function errMsg(e: unknown): string {
  return (e as { statusMessage?: string })?.statusMessage || 'Something went wrong'
}

async function load() {
  const { telegram, talk: t } = await $fetch<{ telegram: TelegramSettings; talk: TalkSettings }>(
    '/api/settings/alerts',
  )
  tg.chatId = telegram.chatId
  tg.enabled = telegram.enabled
  tg.recovery = telegram.recovery
  tgHasToken.value = telegram.hasToken
  tg.token = ''
  talk.url = t.url
  talk.conversation = t.conversation
  talk.enabled = t.enabled
  talkHasToken.value = t.hasToken
  talk.botToken = ''
}
onMounted(load)

async function saveTelegram() {
  const st = status.tg
  st.saving = true
  st.saved = false
  st.error = ''
  try {
    const { telegram } = await $fetch<{ telegram: TelegramSettings }>('/api/settings/alerts', {
      method: 'PUT',
      body: { token: tg.token, chatId: tg.chatId, enabled: tg.enabled, recovery: tg.recovery },
    })
    tgHasToken.value = telegram.hasToken
    tg.token = ''
    st.saved = true
  } catch (e) {
    st.error = errMsg(e)
  } finally {
    st.saving = false
  }
}

async function saveTalk() {
  const st = status.talk
  st.saving = true
  st.saved = false
  st.error = ''
  try {
    const { talk: t } = await $fetch<{ talk: TalkSettings }>('/api/settings/alerts', {
      method: 'PUT',
      body: {
        talk: {
          url: talk.url,
          conversation: talk.conversation,
          botToken: talk.botToken,
          enabled: talk.enabled,
        },
      },
    })
    talkHasToken.value = t.hasToken
    talk.botToken = ''
    st.saved = true
  } catch (e) {
    st.error = errMsg(e)
  } finally {
    st.saving = false
  }
}

async function testTelegram() {
  const st = status.tg
  st.testing = true
  st.test = null
  try {
    st.test = await $fetch<Result>('/api/settings/alerts/test', {
      method: 'POST',
      body: { token: tg.token, chatId: tg.chatId },
    })
  } catch (e) {
    st.test = { ok: false, error: errMsg(e) }
  } finally {
    st.testing = false
  }
}

async function testTalk() {
  const st = status.talk
  st.testing = true
  st.test = null
  try {
    st.test = await $fetch<Result>('/api/settings/alerts/test', {
      method: 'POST',
      body: {
        channel: 'talk',
        talk: { url: talk.url, conversation: talk.conversation, botToken: talk.botToken },
      },
    })
  } catch (e) {
    st.test = { ok: false, error: errMsg(e) }
  } finally {
    st.testing = false
  }
}
</script>

<template>
  <div class="page" data-testid="alerts">
    <header class="page-head">
      <h1>Alerts</h1>
    </header>

    <p class="tsp-muted intro">
      Backup jobs and monitors alert every enabled channel when something fails, and again when it
      recovers.
    </p>

    <!-- Telegram -->
    <section class="card" data-testid="alerts-telegram">
      <div class="card-head">
        <h2>Telegram</h2>
        <label class="switch" :title="tg.enabled ? 'Alerts on' : 'Alerts off'">
          <input
            v-model="tg.enabled"
            type="checkbox"
            aria-label="Enable Telegram alerts"
            @change="saveTelegram"
          >
          <span class="track"><span class="thumb" /></span>
        </label>
      </div>
      <p class="tsp-muted card-sub">
        {{ tg.enabled ? 'Enabled — failures and recoveries are sent.' : 'Disabled — no alerts are sent.' }}
      </p>

      <label class="field">
        <span>Bot token</span>
        <input
          v-model="tg.token"
          class="tsp-input"
          type="password"
          autocomplete="off"
          :placeholder="tgHasToken ? '•••••••• (configured — leave blank to keep)' : 'Bot token'"
        >
      </label>
      <label class="field">
        <span>Chat ID</span>
        <input v-model="tg.chatId" class="tsp-input" type="text" autocomplete="off">
      </label>
      <label class="field toggle">
        <input v-model="tg.recovery" type="checkbox">
        <span>Send recovery notifications</span>
      </label>

      <div class="actions">
        <button
          class="tsp-btn tsp-btn-sm"
          data-testid="test-telegram"
          :disabled="status.tg.testing"
          @click="testTelegram"
        >
          <AppIcon name="plug-connected" /> Test
        </button>
        <button class="tsp-btn tsp-btn-sm tsp-btn-primary" :disabled="status.tg.saving" @click="saveTelegram">
          Save
        </button>
      </div>

      <p v-if="status.tg.test?.ok" class="ok" data-testid="test-result-telegram">✓ Test message sent.</p>
      <p v-else-if="status.tg.test" class="err" data-testid="test-result-telegram">✗ {{ status.tg.test.error }}</p>
      <p v-if="status.tg.saved" class="ok">✓ Saved.</p>
      <p v-if="status.tg.error" class="err">{{ status.tg.error }}</p>
    </section>

    <!-- Nextcloud Talk -->
    <section class="card" data-testid="alerts-talk">
      <div class="card-head">
        <h2>Nextcloud Talk</h2>
        <label class="switch" :title="talk.enabled ? 'Alerts on' : 'Alerts off'">
          <input
            v-model="talk.enabled"
            type="checkbox"
            aria-label="Enable Nextcloud Talk alerts"
            @change="saveTalk"
          >
          <span class="track"><span class="thumb" /></span>
        </label>
      </div>
      <p class="tsp-muted card-sub">
        {{ talk.enabled ? 'Enabled — failures and recoveries are sent.' : 'Disabled — no alerts are sent.' }}
      </p>

      <label class="field">
        <span>Nextcloud URL</span>
        <input
          v-model="talk.url"
          class="tsp-input"
          type="text"
          autocomplete="off"
          placeholder="https://cloud.example.com"
        >
      </label>
      <label class="field">
        <span>Bot token</span>
        <input
          v-model="talk.botToken"
          class="tsp-input"
          type="password"
          autocomplete="off"
          :placeholder="talkHasToken ? '•••••••• (configured — leave blank to keep)' : 'Bot token'"
        >
      </label>
      <label class="field">
        <span>Conversation token</span>
        <input
          v-model="talk.conversation"
          class="tsp-input"
          type="text"
          autocomplete="off"
          placeholder="a1b2c3d4"
        >
      </label>

      <div class="actions">
        <button
          class="tsp-btn tsp-btn-sm"
          data-testid="test-talk"
          :disabled="status.talk.testing"
          @click="testTalk"
        >
          <AppIcon name="plug-connected" /> Test
        </button>
        <button class="tsp-btn tsp-btn-sm tsp-btn-primary" :disabled="status.talk.saving" @click="saveTalk">
          Save
        </button>
      </div>

      <p v-if="status.talk.test?.ok" class="ok" data-testid="test-result-talk">✓ Test message sent.</p>
      <p v-else-if="status.talk.test" class="err" data-testid="test-result-talk">✗ {{ status.talk.test.error }}</p>
      <p v-if="status.talk.saved" class="ok">✓ Saved.</p>
      <p v-if="status.talk.error" class="err">{{ status.talk.error }}</p>

      <div class="info-box">
        <strong>ℹ️ Setting up the bot</strong>
        To create a bot token, go to <strong>Nextcloud Admin → Talk → Bots</strong>, register a new
        bot, and copy the token. The conversation token is the last part of the Talk room URL:
        <code>https://cloud.example.com/call/{conversation-token}</code>. Requires Nextcloud 27+.
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

.info-box {
  margin-top: 16px;
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius);
  background: var(--tsp-bg);
  padding: 12px 14px;
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--tsp-text-muted);
}

.info-box code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.76rem;
}
</style>
