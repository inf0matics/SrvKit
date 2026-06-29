<script setup lang="ts">
// Logged-in app shell — sidebar + content area. Structure mirrors
// design/logged-in-template.html; all colours come from --tsp-* tokens.
const config = useRuntimeConfig().public
const version = config.version
const tipJarUrl = config.tipJarUrl
const githubUrl = 'https://github.com/inf0matics/SrvKit'

// Targets shown as collapsible sub-items under the Backups nav entry.
const { targets, refresh: refreshTargets } = useTargets()
onMounted(refreshTargets)
const backupsOpen = ref(true)

// Server name drives the browser tab title prefix (Settings → General).
const { refresh: refreshServerName } = useServerName()
onMounted(refreshServerName)


// Aggregated host status badge on the Host monitoring nav entry.
const { status: hostStatus, available: hostAvailable, refresh: refreshHost } = useHost()
// Aggregated Docker status badge on the Docker nav entry (10s poll). The badge
// only shows when at least one container is enabled for monitoring.
const {
  status: dockerStatus,
  available: dockerAvailable,
  containers: dockerContainers,
  refresh: refreshDocker,
} = useDocker()
const dockerHasEnabled = computed(() => dockerContainers.value.some((c) => c.enabled))
// Aggregate backup status badge on the Backups nav entry.
const { status: backupsStatus, refresh: refreshBackups } = useBackupsStatus()
// Peer heartbeat badge (crit if any peer is silent; no badge with no peers).
const { status: peersStatus, refresh: refreshPeers } = usePeers()
let hostTimer: ReturnType<typeof setInterval> | undefined
let dockerTimer: ReturnType<typeof setInterval> | undefined
let backupsTimer: ReturnType<typeof setInterval> | undefined
let peersTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  refreshHost()
  hostTimer = setInterval(refreshHost, 60_000)
  refreshDocker()
  dockerTimer = setInterval(refreshDocker, 10_000)
  refreshBackups()
  backupsTimer = setInterval(refreshBackups, 30_000)
  refreshPeers()
  peersTimer = setInterval(refreshPeers, 30_000)
})
onBeforeUnmount(() => {
  clearInterval(hostTimer)
  clearInterval(dockerTimer)
  clearInterval(backupsTimer)
  clearInterval(peersTimer)
})

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
      <NuxtLink to="/app" class="brand">
        <img src="/srvkit-icon-static.svg" width="32" height="32" alt="" class="brand-icon">
        <span class="brand-name">SrvKit<span class="brand-dot" aria-hidden="true">.</span></span>
      </NuxtLink>

      <nav class="nav">
        <NuxtLink to="/app/dashboard" class="nav-item" active-class="active">
          <span class="gutter" />
          <AppIcon name="dashboard" />
          <span>Dashboard</span>
        </NuxtLink>

        <NuxtLink to="/app/host" class="nav-item" active-class="active">
          <span class="gutter" />
          <AppIcon name="server" />
          <span>Host monitoring</span>
          <span
            v-if="hostAvailable"
            class="host-badge"
            :class="`hb-${hostStatus}`"
            data-testid="host-badge"
          >
            {{ hostStatus.toUpperCase() }}
          </span>
        </NuxtLink>

        <NuxtLink to="/app/docker" class="nav-item" active-class="active">
          <span class="gutter" />
          <AppIcon name="docker" />
          <span>Docker</span>
          <span
            v-if="dockerAvailable && dockerHasEnabled"
            class="host-badge"
            :class="`hb-${dockerStatus}`"
            data-testid="docker-badge"
          >
            {{ dockerStatus.toUpperCase() }}
          </span>
        </NuxtLink>

        <div class="nav-group">
          <NuxtLink to="/app/backups" class="nav-item" exact-active-class="active">
            <button
              class="gutter chev"
              :aria-label="backupsOpen ? 'Collapse Backups' : 'Expand Backups'"
              @click.prevent.stop="backupsOpen = !backupsOpen"
            >
              {{ backupsOpen ? '▾' : '▸' }}
            </button>
            <AppIcon name="database-export" />
            <span>Backups</span>
            <span
              v-if="backupsStatus"
              class="host-badge"
              :class="backupsStatus === 'error' ? 'hb-crit' : 'hb-ok'"
              data-testid="backups-badge"
            >
              {{ backupsStatus === 'error' ? 'ERROR' : 'OK' }}
            </span>
          </NuxtLink>
          <div v-if="backupsOpen" class="subnav">
            <NuxtLink
              v-for="t in targets"
              :key="t.id"
              :to="`/app/backups/${t.id}`"
              class="subitem"
              active-class="active"
            >
              <AppIcon name="cloud" />
              <span>{{ t.name }}</span>
            </NuxtLink>
          </div>
        </div>

        <NuxtLink to="/app/peers" class="nav-item" active-class="active">
          <span class="gutter" />
          <AppIcon name="heartbeat" />
          <span>Peers</span>
          <span
            v-if="peersStatus"
            class="host-badge"
            :class="`hb-${peersStatus}`"
            data-testid="peers-badge"
          >
            {{ peersStatus.toUpperCase() }}
          </span>
        </NuxtLink>

        <NuxtLink to="/app/alerts" class="nav-item" active-class="active">
          <span class="gutter" />
          <AppIcon name="bell" />
          <span>Alerts</span>
        </NuxtLink>
      </nav>

      <div class="nav-bottom">
        <div class="divider" />

        <NuxtLink to="/app/settings" class="nav-item" active-class="active">
          <AppIcon name="settings" />
          <span>Settings</span>
        </NuxtLink>

        <button type="button" class="nav-item nav-btn" @click="logout">
          <AppIcon name="logout" />
          <span>Logout</span>
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

        <div class="version-row">
          <span class="ver-badge">
            <AppIcon name="tag" />
            <span data-testid="sidebar-version">v{{ version }}</span>
          </span>
        </div>
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
  text-decoration: none;
  color: inherit;
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

.host-badge {
  margin-left: auto;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  letter-spacing: 0.03em;
}

.hb-ok {
  background: rgba(63, 185, 80, 0.2);
  color: var(--tsp-success, #3fb950);
}

.hb-warn {
  background: rgba(217, 165, 20, 0.22);
  color: var(--tsp-warn, #d9a514);
}

.hb-crit {
  background: rgba(255, 99, 71, 0.22);
  color: var(--tsp-danger);
}

/* Leading gutter so Dashboard/Backups icons align and the chevron has room. */
.gutter {
  width: 14px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.chev {
  background: none;
  border: none;
  color: var(--tsp-text-muted);
  font-size: 11px;
  line-height: 1;
  padding: 2px;
  cursor: pointer;
}

.chev:hover {
  color: var(--tsp-text);
}

.subnav {
  display: flex;
  flex-direction: column;
  margin-top: 2px;
}

.subitem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 40px;
  font-size: 13px;
  color: var(--tsp-text-muted);
  text-decoration: none;
  border-radius: var(--tsp-radius-sm);
}

.subitem span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subitem .app-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.subitem:hover {
  color: var(--tsp-text);
  background: var(--tsp-bg);
}

.subitem.active {
  color: var(--tsp-primary);
  font-weight: 700;
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

.version-row {
  display: flex;
  justify-content: flex-end;
  padding: 8px 12px 0;
}

.ver-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--tsp-border);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  color: var(--tsp-text-muted);
}

.ver-badge .app-icon {
  width: 14px;
  height: 14px;
}

.main {
  flex: 1;
  min-width: 0;
  background: var(--tsp-bg);
}

</style>
