<script setup lang="ts">
// Logged-in app shell — sidebar + content area. Structure mirrors
// design/logged-in-template.html; all colours come from --tsp-* tokens.
const config = useRuntimeConfig().public
const version = config.version
const tipJarUrl = config.tipJarUrl
const githubUrl = 'https://github.com/inf0matics/SrvKit'

/* ---- Logout ---- */
async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await navigateTo('/')
}

/* ---- Theme (scoped to the app shell; the landing stays always-dark) ---- */
const theme = ref<'dark' | 'light'>('dark')

function applyTheme(t: 'dark' | 'light') {
  theme.value = t
  document.documentElement.dataset.theme = t
}

function toggleTheme() {
  const next = theme.value === 'dark' ? 'light' : 'dark'
  localStorage.setItem('srvkit-theme', next)
  applyTheme(next)
}

onMounted(() => {
  const saved = localStorage.getItem('srvkit-theme')
  applyTheme(saved === 'light' ? 'light' : 'dark')
})

onBeforeUnmount(() => {
  // Leaving the shell (e.g. logout → landing) returns to the default dark theme.
  document.documentElement.dataset.theme = 'dark'
})
</script>

<template>
  <div class="shell-root">
    <aside class="sidenav">
      <div class="brand">
        <img src="/srvkit-icon.svg" width="32" height="32" alt="" class="brand-icon">
        <span class="brand-name">SrvKit<span class="brand-dot">.</span></span>
      </div>

      <nav class="nav">
        <NuxtLink to="/app/dashboard" class="nav-item" active-class="active">
          Dashboard
        </NuxtLink>
      </nav>

      <div class="nav-bottom">
        <div class="divider" />

        <button type="button" class="nav-item nav-btn" @click="logout">
          Logout
        </button>

        <button type="button" class="nav-item nav-btn" @click="toggleTheme">
          <AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" />
          <span>{{ theme === 'dark' ? 'Light mode' : 'Dark mode' }}</span>
        </button>

        <a
          v-if="tipJarUrl"
          :href="tipJarUrl"
          target="_blank"
          rel="noopener"
          class="nav-item"
        >
          <AppIcon name="heart" />
          <span>Tip Jar</span>
        </a>

        <a :href="githubUrl" target="_blank" rel="noopener" class="nav-item">
          <AppIcon name="github" />
          <span>GitHub</span>
        </a>

        <p class="version" data-testid="sidebar-version">v{{ version }}</p>
      </div>
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

.brand-dot {
  color: var(--tsp-primary);
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 8px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
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

/* Buttons styled as nav items */
.nav-btn {
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  font-family: inherit;
}

.nav-bottom {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 8px;
}

.divider {
  height: 1px;
  background: var(--tsp-border);
  margin: 12px 4px;
}

.version {
  margin: 6px 0 0;
  padding: 0 12px;
  font-size: 12px;
  color: var(--tsp-text-muted);
}

.main {
  flex: 1;
  min-width: 0;
  background: var(--tsp-bg);
}
</style>
