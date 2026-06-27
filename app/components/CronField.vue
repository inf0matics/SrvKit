<script setup lang="ts">
import { cronIsValid, cronNextLabel } from '~/utils/cron'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const value = computed({
  get: () => props.modelValue,
  set: (v: string) => emit('update:modelValue', v),
})

const PRESETS = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every day at 03:00', cron: '0 3 * * *' },
  { label: 'Every week (Sun 03:00)', cron: '0 3 * * 0' },
  { label: 'Every month (1st, 03:00)', cron: '0 3 1 * *' },
]

// Times are interpreted/shown in the server timezone (where cron runs).
const { timezone } = useServerInfo()

const trimmed = computed(() => props.modelValue.trim())
// null = empty (neutral), true = valid, false = invalid.
const validity = computed<boolean | null>(() =>
  trimmed.value === '' ? null : cronIsValid(trimmed.value),
)
const nextLabel = computed(() =>
  validity.value ? cronNextLabel(trimmed.value, timezone.value) : '',
)

const presetsOpen = ref(false)
function selectPreset(cron: string) {
  emit('update:modelValue', cron)
  presetsOpen.value = false
}

// Close the preset menu on an outside click.
const root = ref<HTMLElement>()
function onDocClick(e: MouseEvent) {
  if (presetsOpen.value && root.value && !root.value.contains(e.target as Node)) {
    presetsOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="root" class="cron-field">
    <div class="row">
      <input
        v-model="value"
        class="tsp-input mono"
        :class="{ invalid: validity === false }"
        type="text"
        placeholder="0 3 * * *"
        autocomplete="off"
        spellcheck="false"
        data-testid="cron-input"
      >
      <button
        type="button"
        class="tsp-btn tsp-btn-sm dots"
        aria-label="Cron presets"
        data-testid="cron-presets"
        @click="presetsOpen = !presetsOpen"
      >
        ···
      </button>
      <div v-if="presetsOpen" class="presets" data-testid="cron-preset-list">
        <button
          v-for="p in PRESETS"
          :key="p.cron"
          type="button"
          class="preset"
          @click="selectPreset(p.cron)"
        >
          <span>{{ p.label }}</span>
          <code>{{ p.cron }}</code>
        </button>
      </div>
    </div>

    <p
      class="next"
      :class="{ ok: validity === true, err: validity === false }"
      data-testid="cron-next"
    >
      <template v-if="validity === false">Invalid cron expression</template>
      <template v-else>
        Next run: {{ nextLabel || '—' }}
        <span v-if="validity && timezone" class="tz">({{ timezone }})</span>
      </template>
    </p>
  </div>
</template>

<style scoped>
.cron-field {
  position: relative;
}

.row {
  display: flex;
  gap: 6px;
  position: relative;
}

.mono {
  font-family: ui-monospace, Menlo, Consolas, monospace;
}

.invalid {
  border-color: var(--tsp-danger);
}

.dots {
  flex-shrink: 0;
  font-weight: 700;
  letter-spacing: 1px;
}

.presets {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 10;
  min-width: 16rem;
  background: var(--tsp-surface);
  border: 1px solid var(--tsp-border);
  border-radius: var(--tsp-radius-sm);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  padding: 4px;
  display: flex;
  flex-direction: column;
}

.preset {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  padding: 7px 9px;
  border-radius: var(--tsp-radius-sm);
}

.preset:hover {
  background: var(--tsp-bg);
}

.preset code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.8rem;
  color: var(--tsp-text-muted);
}

.next {
  margin: 0.3rem 0 0;
  font-size: 0.85rem;
  color: var(--tsp-text-muted);
  font-variant-numeric: tabular-nums;
}

.next.ok {
  color: var(--tsp-success, #3fb950);
}

.next.err {
  color: var(--tsp-danger);
}

.tz {
  color: var(--tsp-text-muted);
}
</style>
