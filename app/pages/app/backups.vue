<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'shell' })
</script>

<template>
  <!-- Backup Targets + Jobs overview lands here (specs 04–07). -->
  <div class="backups" data-testid="backups" />
</template>

<style scoped>
.backups {
  min-height: 100vh;
}
</style>
