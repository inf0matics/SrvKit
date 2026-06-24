<script setup lang="ts">
interface AuthStatus {
  initialized: boolean
  authenticated: boolean
}

const { data: status } = await useFetch<AuthStatus>('/api/auth/status')

// Already signed in → straight to the app.
if (status.value?.authenticated) {
  await navigateTo('/app')
}

const mode = computed<'setup' | 'login'>(() =>
  status.value?.initialized ? 'login' : 'setup',
)

const version = useRuntimeConfig().public.version

const submitting = ref(false)

/* ---------------- Setup mode ---------------- */
const suggestion = ref('')
const customPassword = ref('')

async function loadSuggestion() {
  const { mnemonic } = await $fetch<{ mnemonic: string }>(
    '/api/auth/suggestion',
  )
  suggestion.value = mnemonic
}

onMounted(() => {
  if (mode.value === 'setup') loadSuggestion()
})

const copied = ref(false)
async function copy(text: string) {
  await navigator.clipboard.writeText(text)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

async function save() {
  const password = customPassword.value.trim()
    ? customPassword.value
    : suggestion.value
  if (!password) return
  submitting.value = true
  try {
    await $fetch('/api/auth/setup', { method: 'POST', body: { password } })
    await navigateTo('/app')
  } finally {
    submitting.value = false
  }
}

/* ---------------- Login mode ---------------- */
const password = ref('')
const error = ref('')

async function login() {
  error.value = ''
  submitting.value = true
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { password: password.value },
    })
    await navigateTo('/app')
  } catch (e: unknown) {
    const code = (e as { statusCode?: number }).statusCode
    error.value =
      code === 429
        ? 'Too many attempts. Wait a minute and try again.'
        : 'Incorrect passphrase.'
  } finally {
    submitting.value = false
  }
}

const showHelp = ref(false)
const cliCommand = 'docker exec srvkit srvkit change-password "your new passphrase"'
</script>

<template>
  <div class="landing">
    <main class="hero">
      <img
        src="/srvkit-icon.svg"
        width="96"
        height="96"
        alt="SrvKit"
        class="logo"
      >
      <h1 class="wordmark">SrvKit</h1>
      <p class="tagline">Host monitoring, Docker health, automated backups.</p>

      <!-- ===================== SETUP ===================== -->
      <div v-if="mode === 'setup'" class="form">
        <p class="form-label">Suggested passphrase:</p>
        <code class="tsp-code" data-testid="suggestion">{{ suggestion || '…' }}</code>

        <div class="form-row">
          <button class="tsp-btn" :disabled="!suggestion" @click="copy(suggestion)">
            {{ copied ? 'Copied!' : 'Copy' }}
          </button>
          <button class="tsp-btn" @click="loadSuggestion">Regenerate</button>
        </div>

        <p class="form-label or">Or enter your own:</p>
        <input
          v-model="customPassword"
          class="tsp-input"
          type="text"
          placeholder="Your own passphrase"
          autocomplete="off"
        >

        <button
          class="tsp-btn tsp-btn-primary tsp-btn-block submit"
          :disabled="submitting || (!suggestion && !customPassword.trim())"
          @click="save"
        >
          Save &amp; continue
        </button>

        <p class="warn">Write this down — there is no password recovery.</p>
      </div>

      <!-- ===================== LOGIN ===================== -->
      <form v-else class="form" @submit.prevent="login">
        <input
          v-model="password"
          class="tsp-input"
          type="password"
          placeholder="Passphrase"
          autocomplete="current-password"
          autofocus
        >
        <p v-if="error" class="tsp-error" data-testid="login-error">{{ error }}</p>
        <button
          class="tsp-btn tsp-btn-primary tsp-btn-block submit"
          type="submit"
          :disabled="submitting"
        >
          Login
        </button>
        <button type="button" class="tsp-link-muted cant" @click="showHelp = true">
          Can't login?
        </button>
      </form>
    </main>

    <footer class="footer" data-testid="version">SrvKit · v{{ version }}</footer>

    <!-- ===================== HELP MODAL ===================== -->
    <div v-if="showHelp" class="overlay" @click.self="showHelp = false">
      <div class="tsp-card" role="dialog" aria-label="Can't login?">
        <div class="modal-head">
          <h2>Can't login?</h2>
          <button class="tsp-btn close" aria-label="Close" @click="showHelp = false">
            ✕
          </button>
        </div>
        <p class="tsp-muted">Passwords can only be changed via the command line:</p>
        <code class="tsp-code">{{ cliCommand }}</code>
        <button class="tsp-btn copy-cli" @click="copy(cliCommand)">
          {{ copied ? 'Copied!' : 'Copy' }}
        </button>
        <p class="tsp-muted note">All active sessions will be logged out immediately.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.landing {
  min-height: 100svh;
  display: flex;
  flex-direction: column;
  background: var(--tsp-bg);
}

.hero {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 48px 24px 32px;
}

.logo {
  display: block;
  border-radius: 18px;
}

.wordmark {
  margin: 18px 0 0;
  font-family: 'Space Grotesk', system-ui, sans-serif;
  font-weight: 700;
  font-size: clamp(2.5rem, 8vw, 4rem);
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--tsp-text);
}

.tagline {
  max-width: 480px;
  margin: 16px 0 36px;
  font-size: 1rem;
  font-weight: 600;
  color: var(--tsp-text-muted);
  line-height: 1.6;
}

/* Form embedded directly in the hero — no card. */
.form {
  width: 100%;
  max-width: 360px;
  text-align: left;
}

.form-label {
  margin: 0 0 0.4rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--tsp-text-muted);
}

.form-label.or {
  margin-top: 1.25rem;
}

.form-row {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.6rem;
}

.submit {
  margin-top: 1.25rem;
}

.warn {
  margin: 1rem 0 0;
  font-size: 0.85rem;
  color: var(--tsp-danger);
}

.cant {
  display: block;
  margin: 1rem auto 0;
  text-align: center;
}

.footer {
  align-self: flex-end;
  padding: 16px 20px 20px;
  font-size: 12px;
  color: var(--tsp-text-muted);
}

/* ---------------- Modal ---------------- */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.modal-head h2 {
  margin: 0;
  font-size: 1.2rem;
}

.close {
  padding: 0.25rem 0.5rem;
}

.copy-cli {
  margin-top: 0.75rem;
}

.note {
  margin-bottom: 0;
}
</style>
