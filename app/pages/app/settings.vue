<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'shell' })
usePageTitle('Settings')

// Shared with the tab-title prefix so it updates live when saved here.
const { serverName: sharedServerName } = useServerName()

const form = reactive({ serverName: '' })
const saving = ref(false)
const saved = ref(false)
const saveError = ref('')

async function load() {
  const { serverName } = await $fetch<{ serverName: string }>('/api/settings/general')
  form.serverName = serverName
  sharedServerName.value = serverName
}
onMounted(load)

async function save() {
  saving.value = true
  saved.value = false
  saveError.value = ''
  try {
    const { serverName } = await $fetch<{ serverName: string }>('/api/settings/general', {
      method: 'PUT',
      body: { serverName: form.serverName },
    })
    form.serverName = serverName
    sharedServerName.value = serverName
    saved.value = true
  } catch (e: unknown) {
    saveError.value = (e as { statusMessage?: string }).statusMessage || 'Could not save'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page" data-testid="settings">
    <header class="page-head">
      <h1>Settings</h1>
    </header>

    <section class="card">
      <h2>General</h2>
      <label class="field">
        <span>Server name</span>
        <input
          v-model="form.serverName"
          class="tsp-input"
          type="text"
          autocomplete="off"
          placeholder="e.g. prod-1"
        >
      </label>
      <p class="tsp-muted hint">
        Used to prefix alert messages — <code>[{{ form.serverName || 'name' }}|SrvKit]</code>
        when set, otherwise <code>[SrvKit]</code>.
      </p>

      <div class="actions">
        <button
          class="tsp-btn tsp-btn-sm tsp-btn-primary"
          :disabled="saving"
          @click="save"
        >
          Save
        </button>
      </div>
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

.card {
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius);
  background: var(--tsp-surface);
  padding: 20px 22px;
  margin-top: 16px;
}

.card h2 {
  margin: 0 0 14px;
  font-size: 1.15rem;
}

.field {
  display: block;
  margin-bottom: 0.5rem;
}

.field > span {
  display: block;
  margin-bottom: 0.3rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--tsp-text-muted);
}

.hint {
  margin: 0 0 12px;
  font-size: 0.85rem;
}

.hint code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.82rem;
}

.actions {
  display: flex;
  gap: 0.5rem;
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
