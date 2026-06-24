<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'shell' })
</script>

<template>
  <!-- Empty for now. Feature views render here in later specs. -->
  <div class="dashboard" data-testid="dashboard" />
</template>

<style scoped>
.dashboard {
  min-height: 100vh;
}
</style>
