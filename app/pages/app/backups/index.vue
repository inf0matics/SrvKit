<script setup lang="ts">
import type { TargetSummary } from '~/composables/useTargets'
import { targetDestination } from '~/utils/targetPath'

definePageMeta({ middleware: 'auth', layout: 'shell' })
usePageTitle('Backups')

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
const form = reactive({
  type: 'nextcloud',
  name: '',
  host: '',
  username: '',
  password: '',
})
const isLocal = computed(() => form.type === 'local')
const formError = ref('')
const saving = ref(false)

const modalTest = ref<TestResult | null>(null)
const modalTesting = ref(false)

function openAdd() {
  modal.id = null
  Object.assign(form, {
    type: 'nextcloud',
    name: '',
    host: '',
    username: '',
    password: '',
  })
  formError.value = ''
  modalTest.value = null
  modal.open = true
}

// The type decides which fields exist, so it is chosen once and then fixed —
// switching means deleting the target and creating a new one.
function chooseType(type: string) {
  form.type = type
  modalTest.value = null
  formError.value = ''
}

function openEdit(t: Target) {
  modal.id = t.id
  Object.assign(form, {
    type: t.type,
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
    } else if (isLocal.value) {
      // A new local target has no root yet — this tests the targets mount itself.
      modalTest.value = await $fetch<TestResult>('/api/backups/targets/test', {
        method: 'POST',
        body: { type: 'local', rootDir: '' },
      })
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

/* ---- row display ---- */
const TYPE_LABELS: Record<string, string> = {
  nextcloud: 'Nextcloud',
  local: 'Local',
}
const typeLabel = (t: Target) => TYPE_LABELS[t.type] ?? 'Nextcloud'
// A local row shows its directory where a Nextcloud row shows its host.
const destination = targetDestination

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
          <span class="t-title">
            <span class="t-name">{{ t.name }}</span>
            <span class="t-type-badge" data-testid="target-type">{{ typeLabel(t) }}</span>
          </span>
          <span class="t-host tsp-muted">{{ destination(t) }}</span>
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

        <!-- Step 1: the type. Fixed once the target exists — the fields behind
             it differ, so switching means delete and re-create. -->
        <div v-if="!modal.id" class="field">
          <span>Type</span>
          <div class="type-choice" role="radiogroup" aria-label="Target type">
            <button
              type="button"
              class="type-option"
              role="radio"
              :aria-checked="!isLocal"
              :class="{ active: !isLocal }"
              @click="chooseType('nextcloud')"
            >
              Nextcloud
            </button>
            <button
              type="button"
              class="type-option"
              role="radio"
              :aria-checked="isLocal"
              :class="{ active: isLocal }"
              @click="chooseType('local')"
            >
              Local directory
            </button>
          </div>
        </div>

        <label class="field">
          <span>Name</span>
          <input v-model="form.name" class="tsp-input" type="text" autocomplete="off">
        </label>

        <template v-if="!isLocal">
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
        </template>

        <p v-else class="local-note tsp-muted" data-testid="local-note">
          A local target lives on the same machine as the data it protects. It
          survives a bad migration or a broken container — not a dead disk or a
          lost server. Keep an off-site target alongside it.
          <br>
          Pick the directory after saving, with <strong>Choose location</strong>.
        </p>

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

.t-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* Muted pill badge — TSP chip style, as used for job types. */
.t-type-badge {
  display: inline-block;
  padding: 1px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  background: var(--tsp-border);
  color: var(--tsp-text-muted);
  flex-shrink: 0;
}

.type-choice {
  display: flex;
  gap: 8px;
}

.type-option {
  flex: 1;
  padding: 9px 12px;
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius);
  background: transparent;
  color: var(--tsp-text-muted);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}

.type-option.active {
  border-color: var(--tsp-primary);
  color: var(--tsp-primary);
}

.local-note {
  margin: 0 0 0.9rem;
  font-size: 0.82rem;
  line-height: 1.5;
}

/* Modal */
.overlay {
  position: fixed;
  inset: 0;
  /* Without this the overlay paints in DOM order, so any positioned element in
     a later sibling (the job rows below) shows straight through the modal. */
  z-index: 100;
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
