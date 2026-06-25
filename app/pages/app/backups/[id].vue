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
      <p class="meta tsp-muted">{{ target.host }} · /{{ target.rootDir }}</p>
      <TargetJobs :target="target" :targets="targets" />
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

.meta {
  margin: 0;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.85rem;
}

.notfound {
  margin-top: 24px;
}
</style>
