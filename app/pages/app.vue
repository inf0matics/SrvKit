<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const loggingOut = ref(false)
async function logout() {
  loggingOut.value = true
  await $fetch('/api/auth/logout', { method: 'POST' })
  await navigateTo('/')
}
</script>

<template>
  <div class="tsp-center">
    <div class="tsp-card">
      <h1>SrvKit</h1>
      <p class="tsp-muted" data-testid="app-welcome">
        You're signed in. Host monitoring, Docker health and backups will live here.
      </p>
      <button
        class="tsp-btn tsp-btn-block logout"
        :disabled="loggingOut"
        @click="logout"
      >
        Log out
      </button>
    </div>
  </div>
</template>

<style scoped>
h1 {
  margin: 0 0 1rem;
  font-size: 1.5rem;
}
.logout {
  margin-top: 1.5rem;
}
</style>
