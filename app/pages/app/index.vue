<script setup lang="ts">
// /app is just an entry point — send the user to the dashboard.
definePageMeta({ middleware: 'auth' })
await navigateTo('/app/dashboard', { redirectCode: 302 })
</script>

<template>
  <div />
</template>
