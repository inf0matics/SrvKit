<script setup lang="ts">
import type { TargetSummary } from '~/composables/useTargets'

interface TestResult {
  ok: boolean
  message: string
}
interface BrowseResult {
  ok: boolean
  path: string
  dirs: string[]
  message?: string
}

const props = defineProps<{ target: TargetSummary }>()
const emit = defineEmits<{ changed: [] }>()

/* ---- test connection ---- */
const testResult = ref<TestResult | null>(null)
const testing = ref(false)

async function testConnection() {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await $fetch<TestResult>(
      `/api/backups/targets/${props.target.id}/test`,
      { method: 'POST' },
    )
  } catch {
    testResult.value = { ok: false, message: 'Test request failed' }
  } finally {
    testing.value = false
  }
}

/* ---- directory browser ---- */
const browser = reactive<{ open: boolean; path: string }>({ open: false, path: '' })
const browseDirs = ref<string[]>([])
const browseError = ref('')
const browseLoading = ref(false)
const browseSaving = ref(false)
const segments = computed(() => browser.path.split('/').filter(Boolean))

function openBrowser() {
  browser.path = props.target.rootDir
  browseDirs.value = []
  browseError.value = ''
  browser.open = true
  loadDirs()
}

async function loadDirs() {
  browseLoading.value = true
  browseError.value = ''
  try {
    const res = await $fetch<BrowseResult>(
      `/api/backups/targets/${props.target.id}/browse`,
      { method: 'POST', body: { path: browser.path } },
    )
    if (res.ok) {
      browseDirs.value = res.dirs
    } else {
      browseDirs.value = []
      browseError.value = res.message || 'Could not list folders'
    }
  } catch {
    browseDirs.value = []
    browseError.value = 'Browse request failed'
  } finally {
    browseLoading.value = false
  }
}

function enterDir(name: string) {
  browser.path = browser.path ? `${browser.path}/${name}` : name
  loadDirs()
}
function goTo(path: string) {
  browser.path = path
  loadDirs()
}

async function selectHere() {
  browseSaving.value = true
  try {
    await $fetch(`/api/backups/targets/${props.target.id}`, {
      method: 'PUT',
      body: { rootDir: browser.path },
    })
    emit('changed')
    browser.open = false
  } finally {
    browseSaving.value = false
  }
}
</script>

<template>
  <div class="location">
    <div class="loc-row">
      <span class="loc-path" data-testid="location">/{{ target.rootDir }}</span>
      <button class="tsp-btn tsp-btn-sm" @click="openBrowser">
        <AppIcon name="folder" />
        Choose location
      </button>
      <button class="tsp-btn tsp-btn-sm" :disabled="testing" @click="testConnection">
        {{ testing ? 'Testing…' : 'Test' }}
      </button>
    </div>
    <p v-if="testResult" :class="testResult.ok ? 'test-ok' : 'test-err'">
      {{ testResult.message }}
    </p>

    <!-- Directory browser (full-page overlay) -->
    <div v-if="browser.open" class="overlay" @click.self="browser.open = false">
      <div class="tsp-card browser">
        <div class="browser-head">
          <h2>Choose location</h2>
          <button class="tsp-btn close" aria-label="Close" @click="browser.open = false">
            ✕
          </button>
        </div>

        <nav class="breadcrumb" aria-label="Path">
          <button class="crumb" :class="{ sel: segments.length === 0 }" @click="goTo('')">
            /
          </button>
          <template v-for="(seg, i) in segments" :key="i">
            <span v-if="i > 0" class="sep">/</span>
            <button
              class="crumb"
              :class="{ sel: i === segments.length - 1 }"
              @click="goTo(segments.slice(0, i + 1).join('/'))"
            >
              {{ seg }}
            </button>
          </template>
        </nav>

        <div class="browse-list">
          <p v-if="browseLoading" class="tsp-muted pad" data-testid="browse-loading">
            Loading…
          </p>
          <p v-else-if="browseError" class="test-err pad" data-testid="browse-error">
            {{ browseError }}
          </p>
          <p v-else-if="!browseDirs.length" class="tsp-muted pad">No sub-folders here.</p>
          <button v-for="d in browseDirs" :key="d" class="dir" @click="enterDir(d)">
            <AppIcon name="folder" /> {{ d }}
          </button>
        </div>

        <div class="modal-actions">
          <span class="current tsp-muted">/{{ browser.path }}</span>
          <div class="modal-actions-right">
            <button class="tsp-btn tsp-btn-sm" @click="browser.open = false">Cancel</button>
            <button
              class="tsp-btn tsp-btn-sm tsp-btn-primary"
              :disabled="browseSaving"
              @click="selectHere"
            >
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.loc-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.95rem;
}

.loc-path {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  color: var(--tsp-text);
  margin-right: auto;
}

.test-ok {
  margin: 8px 0 0;
  font-size: 0.9rem;
  color: #8fcf8f;
}

.test-err {
  margin: 8px 0 0;
  font-size: 0.9rem;
  color: var(--tsp-danger);
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

.browser {
  width: 100%;
  max-width: 42rem;
  height: 80vh;
  display: flex;
  flex-direction: column;
}

.browser-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.browser-head h2 {
  margin: 0;
  font-size: 1.2rem;
}

.close {
  padding: 0.25rem 0.5rem;
}

.breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  margin-bottom: 10px;
  font-size: 0.95rem;
}

.crumb {
  background: none;
  border: none;
  color: var(--tsp-text-muted);
  font: inherit;
  cursor: pointer;
  padding: 2px 5px;
  border-radius: var(--tsp-radius-sm);
}

.crumb:hover {
  color: var(--tsp-text);
  background: var(--tsp-bg);
}

.crumb.sel {
  color: var(--tsp-primary);
  font-weight: 700;
}

.breadcrumb .sep {
  color: var(--tsp-text-muted);
}

.browse-list {
  flex: 1;
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius-sm);
  overflow-y: auto;
  padding: 4px;
}

.dir {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: var(--tsp-text);
  font: inherit;
  font-size: 0.9rem;
  padding: 7px 8px;
  border-radius: var(--tsp-radius-sm);
  cursor: pointer;
}

.dir:hover {
  background: var(--tsp-bg);
}

.browse-list .pad {
  padding: 8px;
  margin: 0;
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

.current {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 0.85rem;
  color: var(--tsp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
