<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'shell' })

interface Target {
  id: string
  name: string
  host: string
  username: string
  rootDir: string
  createdAt: string
}

interface TestResult {
  ok: boolean
  message: string
}

// Client-only so the browser sends the session cookie (the API is guarded).
const { data: targets, refresh } = await useFetch<Target[]>(
  '/api/backups/targets',
  { server: false, default: () => [] },
)

/* ---- collapse / expand (expanded by default) ---- */
const collapsed = ref<Record<string, boolean>>({})
const isExpanded = (id: string) => !collapsed.value[id]
const toggle = (id: string) => (collapsed.value[id] = !collapsed.value[id])

/* ---- add / edit modal ---- */
const modal = reactive<{ open: boolean; id: string | null }>({
  open: false,
  id: null,
})
const form = reactive({
  name: '',
  host: '',
  username: '',
  password: '',
  rootDir: '',
})
const formError = ref('')
const saving = ref(false)

const modalTest = ref<TestResult | null>(null)
const modalTesting = ref(false)

function openAdd() {
  modal.id = null
  Object.assign(form, {
    name: '',
    host: '',
    username: '',
    password: '',
    rootDir: '',
  })
  formError.value = ''
  modalTest.value = null
  modal.open = true
}

function openEdit(t: Target) {
  modal.id = t.id
  Object.assign(form, {
    name: t.name,
    host: t.host,
    username: t.username,
    password: '',
    rootDir: t.rootDir,
  })
  formError.value = ''
  modalTest.value = null
  modal.open = true
}

// Test from inside the modal. In edit mode with a blank password we fall back
// to the stored credentials of the saved target; otherwise we test what's typed.
async function testForm() {
  modalTest.value = null
  modalTesting.value = true
  try {
    if (modal.id && !form.password) {
      modalTest.value = await $fetch<TestResult>(
        `/api/backups/targets/${modal.id}/test`,
        { method: 'POST' },
      )
    } else {
      modalTest.value = await $fetch<TestResult>('/api/backups/targets/test', {
        method: 'POST',
        body: {
          host: form.host,
          username: form.username,
          password: form.password,
        },
      })
    }
  } catch (e: unknown) {
    modalTest.value = {
      ok: false,
      message:
        (e as { statusMessage?: string }).statusMessage || 'Test request failed',
    }
  } finally {
    modalTesting.value = false
  }
}

async function save() {
  formError.value = ''
  saving.value = true
  try {
    if (modal.id) {
      await $fetch(`/api/backups/targets/${modal.id}`, {
        method: 'PUT',
        body: { ...form },
      })
    } else {
      await $fetch('/api/backups/targets', { method: 'POST', body: { ...form } })
    }
    await refresh()
    modal.open = false
  } catch (e: unknown) {
    formError.value =
      (e as { statusMessage?: string }).statusMessage || 'Could not save target'
  } finally {
    saving.value = false
  }
}

/* ---- test connection ---- */
const testResults = ref<Record<string, TestResult>>({})
const testing = ref<Record<string, boolean>>({})

async function testConnection(t: Target) {
  testing.value[t.id] = true
  try {
    testResults.value[t.id] = await $fetch<TestResult>(
      `/api/backups/targets/${t.id}/test`,
      { method: 'POST' },
    )
  } catch {
    testResults.value[t.id] = { ok: false, message: 'Test request failed' }
  } finally {
    testing.value[t.id] = false
  }
}

/* ---- delete ---- */
async function remove(t: Target) {
  if (!confirm(`Delete target "${t.name}"? This cannot be undone.`)) return
  await $fetch(`/api/backups/targets/${t.id}`, { method: 'DELETE' })
  await refresh()
}
</script>

<template>
  <div class="page" data-testid="backups">
    <header class="page-head">
      <h1>Backups</h1>
      <button class="tsp-btn tsp-btn-primary" @click="openAdd">+ Add Target</button>
    </header>

    <p v-if="!targets.length" class="empty tsp-muted">
      No targets yet. Add one to start backing up.
    </p>

    <section v-for="t in targets" :key="t.id" class="target">
      <div class="target-head">
        <button
          class="chevron"
          :aria-label="isExpanded(t.id) ? 'Collapse' : 'Expand'"
          @click="toggle(t.id)"
        >
          {{ isExpanded(t.id) ? '▾' : '▸' }}
        </button>
        <div class="target-info">
          <div class="target-name">{{ t.name }}</div>
          <div class="target-host tsp-muted">
            {{ t.host }}<span v-if="t.rootDir"> · {{ t.rootDir }}/</span>
          </div>
        </div>
        <div class="target-actions">
          <button class="tsp-btn" :disabled="testing[t.id]" @click="testConnection(t)">
            {{ testing[t.id] ? 'Testing…' : 'Test' }}
          </button>
          <button class="tsp-btn" @click="openEdit(t)">Edit</button>
          <button class="tsp-btn" @click="remove(t)">Delete</button>
        </div>
      </div>

      <p
        v-if="testResults[t.id]"
        :class="testResults[t.id]!.ok ? 'test-ok' : 'test-err'"
      >
        {{ testResults[t.id]!.message }}
      </p>

      <div v-if="isExpanded(t.id)" class="target-body">
        <p class="tsp-muted">Backup jobs will appear here.</p>
      </div>
    </section>

    <!-- Add / Edit modal -->
    <div v-if="modal.open" class="overlay" @click.self="modal.open = false">
      <div class="tsp-card">
        <h2>{{ modal.id ? 'Edit Target' : 'Add Target' }}</h2>

        <label class="field">
          <span>Name</span>
          <input v-model="form.name" class="tsp-input" type="text" autocomplete="off">
        </label>
        <label class="field">
          <span>Host</span>
          <input
            v-model="form.host"
            class="tsp-input"
            type="url"
            placeholder="https://nextcloud.example.com"
            autocomplete="off"
          >
        </label>
        <label class="field">
          <span>Root directory</span>
          <input
            v-model="form.rootDir"
            class="tsp-input"
            type="text"
            placeholder="srvkit/"
            autocomplete="off"
          >
        </label>
        <label class="field">
          <span>Username</span>
          <input v-model="form.username" class="tsp-input" type="text" autocomplete="off">
        </label>
        <label class="field">
          <span>Password</span>
          <input
            v-model="form.password"
            class="tsp-input"
            type="password"
            :placeholder="modal.id ? 'Leave blank to keep current' : ''"
            autocomplete="new-password"
          >
        </label>

        <p v-if="formError" class="test-err">{{ formError }}</p>
        <p
          v-if="modalTest"
          :class="modalTest.ok ? 'test-ok' : 'test-err'"
        >
          {{ modalTest.message }}
        </p>

        <div class="modal-actions">
          <button class="tsp-btn" :disabled="modalTesting" @click="testForm">
            {{ modalTesting ? 'Testing…' : 'Test' }}
          </button>
          <div class="modal-actions-right">
            <button class="tsp-btn" @click="modal.open = false">Cancel</button>
            <button class="tsp-btn tsp-btn-primary" :disabled="saving" @click="save">
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 896px;
  margin: 0 auto;
  padding: 40px 24px 64px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.page-head h1 {
  margin: 0;
  font-size: 1.6rem;
}

.empty {
  margin-top: 24px;
}

.target {
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius);
  background: var(--tsp-surface);
  padding: 14px 16px;
  margin-top: 16px;
}

.target-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.chevron {
  background: none;
  border: none;
  color: var(--tsp-text-muted);
  font-size: 14px;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
}

.target-info {
  min-width: 0;
  flex: 1;
}

.target-name {
  font-weight: 700;
}

.target-host {
  font-size: 0.85rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.target-body {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--tsp-border);
}

.test-ok {
  margin: 10px 0 0;
  font-size: 0.9rem;
  color: #8fcf8f;
}

.test-err {
  margin: 10px 0 0;
  font-size: 0.9rem;
  color: var(--tsp-danger);
}

/* Modal */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

.overlay h2 {
  margin: 0 0 1rem;
  font-size: 1.2rem;
}

.field {
  display: block;
  margin-bottom: 0.9rem;
}

.field span {
  display: block;
  margin-bottom: 0.3rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--tsp-text-muted);
}

.modal-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 1.25rem;
}

.modal-actions-right {
  display: flex;
  gap: 0.5rem;
}
</style>
