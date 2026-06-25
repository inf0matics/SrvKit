<script setup lang="ts">
import type { TargetSummary } from '~/composables/useTargets'

definePageMeta({ middleware: 'auth', layout: 'shell' })

type Target = TargetSummary

interface TestResult {
  ok: boolean
  message: string
}

// Shared targets state, kept in sync with the sidebar. Client-only fetch so the
// session cookie is sent (the API is guarded).
const { targets, refresh } = useTargets()
onMounted(refresh)

/* ---- add / edit modal ---- */
const modal = reactive<{ open: boolean; id: string | null }>({
  open: false,
  id: null,
})
const form = reactive({ name: '', host: '', username: '', password: '' })
const formError = ref('')
const saving = ref(false)

const modalTest = ref<TestResult | null>(null)
const modalTesting = ref(false)

function openAdd() {
  modal.id = null
  Object.assign(form, { name: '', host: '', username: '', password: '' })
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
        body: { host: form.host, username: form.username, password: form.password },
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

/* ---- inline delete confirmation ---- */
const confirmingDelete = ref<string | null>(null)

async function confirmDelete(t: Target) {
  await $fetch(`/api/backups/targets/${t.id}`, { method: 'DELETE' })
  confirmingDelete.value = null
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

    <div v-for="t in targets" :key="t.id" class="target-row">
      <template v-if="confirmingDelete === t.id">
        <div class="target-link">
          <span class="t-name">{{ t.name }}</span>
          <span class="t-confirm tsp-muted">
            Delete this target? All jobs will be lost.
          </span>
        </div>
        <div class="t-actions">
          <button class="tsp-btn tsp-btn-sm" @click="confirmingDelete = null">
            Cancel
          </button>
          <button class="tsp-btn tsp-btn-sm tsp-btn-danger" @click="confirmDelete(t)">
            Delete
          </button>
        </div>
      </template>
      <template v-else>
        <NuxtLink :to="`/app/backups/${t.id}`" class="target-link">
          <span class="t-name">{{ t.name }}</span>
          <span class="t-host tsp-muted">{{ t.host }}</span>
        </NuxtLink>
        <div class="t-actions">
          <button class="tsp-btn tsp-btn-sm" @click="openEdit(t)">Edit</button>
          <button
            class="tsp-btn tsp-btn-sm tsp-btn-icon"
            aria-label="Delete target"
            @click="confirmingDelete = t.id"
          >
            <AppIcon name="trash" />
          </button>
        </div>
      </template>
    </div>

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
        <p v-if="modalTest" :class="modalTest.ok ? 'test-ok' : 'test-err'">
          {{ modalTest.message }}
        </p>

        <div class="modal-actions">
          <button class="tsp-btn tsp-btn-sm" :disabled="modalTesting" @click="testForm">
            <AppIcon name="plug-connected" />
            {{ modalTesting ? 'Testing…' : 'Test' }}
          </button>
          <div class="modal-actions-right">
            <button class="tsp-btn tsp-btn-sm" @click="modal.open = false">Cancel</button>
            <button
              class="tsp-btn tsp-btn-sm tsp-btn-primary"
              :disabled="saving"
              @click="save"
            >
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

.target-row {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius);
  background: var(--tsp-surface);
  padding: 14px 16px;
  margin-top: 12px;
}

.target-link {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-decoration: none;
  color: inherit;
}

.target-link:hover .t-name {
  color: var(--tsp-primary);
}

.t-name {
  font-weight: 700;
}

.t-host {
  font-size: 0.85rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.t-confirm {
  font-size: 0.85rem;
}

.t-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
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
