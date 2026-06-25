<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'shell' })

const route = useRoute()
const { targets, refresh } = useTargets()
onMounted(refresh)

const target = computed(() =>
  targets.value.find((t) => t.id === (route.params.id as string)),
)
</script>

<template>
  <div class="page" data-testid="target-page">
    <NuxtLink to="/app/backups" class="back tsp-link-muted">← All targets</NuxtLink>

    <template v-if="target">
      <h1>{{ target.name }}</h1>
      <p class="host tsp-muted">{{ target.host }}</p>
      <TargetLocation :target="target" @changed="refresh" />

      <hr class="divider">

      <TargetJobs :target="target" />
    </template>

    <p v-else class="notfound tsp-muted">
      Target not found. <NuxtLink to="/app/backups">Back to Backups</NuxtLink>
    </p>
  </div>
</template>

<style scoped>
.page {
  max-width: 896px;
  margin: 0 auto;
  padding: 40px 24px 64px;
}

.back {
  display: inline-block;
  margin-bottom: 12px;
}

.page h1 {
  margin: 4px 0;
  font-size: 1.6rem;
}

.host {
  margin: 0 0 12px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.85rem;
}

.divider {
  border: none;
  border-top: 1px solid var(--tsp-border);
  margin: 20px 0;
}

.notfound {
  margin-top: 24px;
}
</style>
