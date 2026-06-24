<script setup lang="ts">
// Logged-in app shell — sidebar + content area. Structure mirrors
// design/logged-in-template.html; all colours come from --tsp-* tokens.
</script>

<template>
  <div class="shell-root">
    <aside class="sidenav">
      <div class="brand">
        <img src="/srvkit-icon.svg" width="32" height="32" alt="" class="brand-icon">
        <span class="brand-name">SrvKit</span>
      </div>
      <nav class="nav">
        <NuxtLink to="/app/dashboard" class="nav-item" active-class="active">
          Dashboard
        </NuxtLink>
      </nav>
    </aside>

    <main class="main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.shell-root {
  display: flex;
  min-height: 100vh;
  background: var(--tsp-bg);
  color: var(--tsp-text);
}

.sidenav {
  width: 224px;
  flex-shrink: 0;
  background: var(--tsp-surface);
  border-right: 1px solid var(--tsp-border);
  display: flex;
  flex-direction: column;
  padding: 20px 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px 16px;
  margin: 0 8px 12px;
  border-bottom: 1px solid var(--tsp-border);
}

.brand-icon {
  display: block;
  flex-shrink: 0;
}

.brand-name {
  font-family: 'Space Grotesk', system-ui, sans-serif;
  font-weight: 700;
  font-size: 20px;
  letter-spacing: -0.02em;
  color: var(--tsp-text);
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 8px;
}

.nav-item {
  display: block;
  padding: 8px 12px;
  border-radius: var(--tsp-radius-sm);
  font-size: 14px;
  font-weight: 700;
  color: var(--tsp-text-muted);
  text-decoration: none;
  cursor: pointer;
}

.nav-item:hover {
  color: var(--tsp-text);
  background: var(--tsp-bg);
}

.nav-item.active {
  background: var(--tsp-primary);
  color: var(--tsp-on-primary);
}

.main {
  flex: 1;
  min-width: 0;
  background: var(--tsp-bg);
}
</style>
