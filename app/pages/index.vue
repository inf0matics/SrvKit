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
    const status = (e as { statusCode?: number }).statusCode
    error.value =
      status === 429
        ? 'Too many attempts. Wait a minute and try again.'
        : 'Incorrect password.'
  } finally {
    submitting.value = false
  }
}

const showHelp = ref(false)
const cliCommand = 'docker exec srvkit srvkit change-password "your new passphrase"'
</script>

<template>
  <div class="tsp-center">
    <!-- ===================== SETUP ===================== -->
    <div v-if="mode === 'setup'" class="tsp-card">
      <h1>SrvKit — Initial Setup</h1>

      <p class="tsp-muted">Suggested passphrase:</p>
      <code class="tsp-code" data-testid="suggestion">{{ suggestion || '…' }}</code>

      <div class="row">
        <button class="tsp-btn" :disabled="!suggestion" @click="copy(suggestion)">
          {{ copied ? 'Copied!' : 'Copy' }}
        </button>
        <button class="tsp-btn" @click="loadSuggestion">Regenerate</button>
      </div>

      <p class="tsp-muted or">Or enter your own:</p>
      <input
        v-model="customPassword"
        class="tsp-input"
        type="text"
        placeholder="Your own password"
        autocomplete="off"
      >

      <button
        class="tsp-btn tsp-btn-primary tsp-btn-block save"
        :disabled="submitting || (!suggestion && !customPassword.trim())"
        @click="save"
      >
        Save &amp; continue
      </button>

      <p class="tsp-error warn">
        Write this down — there is no password recovery.
      </p>
    </div>

    <!-- ===================== LOGIN ===================== -->
    <div v-else class="tsp-card">
      <h1>SrvKit</h1>

      <form @submit.prevent="login">
        <input
          v-model="password"
          class="tsp-input"
          type="password"
          placeholder="Password"
          autocomplete="current-password"
          autofocus
        >
        <p v-if="error" class="tsp-error" data-testid="login-error">{{ error }}</p>
        <button
          class="tsp-btn tsp-btn-primary tsp-btn-block save"
          type="submit"
          :disabled="submitting"
        >
          Login
        </button>
      </form>

      <div class="cant">
        <button class="tsp-link-muted" @click="showHelp = true">Can't login?</button>
      </div>
    </div>

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
        <button class="tsp-btn" @click="copy(cliCommand)">
          {{ copied ? 'Copied!' : 'Copy' }}
        </button>
        <p class="tsp-muted note">All active sessions will be logged out immediately.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
h1 {
  margin: 0 0 1.25rem;
  font-size: 1.5rem;
}
.row {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.or {
  margin-top: 1.5rem;
}
.save {
  margin-top: 1.25rem;
}
.warn {
  margin-top: 1rem;
  margin-bottom: 0;
}
.cant {
  margin-top: 1rem;
  text-align: center;
}
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
}
.modal-head h2 {
  margin: 0;
  font-size: 1.2rem;
}
.close {
  padding: 0.25rem 0.5rem;
}
.note {
  margin-bottom: 0;
}
</style>
