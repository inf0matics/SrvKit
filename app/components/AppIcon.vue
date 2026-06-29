<script setup lang="ts">
// Lightweight inline Tabler-style icons (stroke = currentColor). Avoids pulling
// in a full icon module for the handful of glyphs the chrome needs.
defineProps<{
  name:
    | 'sun'
    | 'moon'
    | 'heart'
    | 'github'
    | 'logout'
    | 'tag'
    | 'dashboard'
    | 'database-export'
    | 'folder'
    | 'cloud'
    | 'trash'
    | 'edit'
    | 'plug-connected'
    | 'play'
    | 'bell'
    | 'settings'
    | 'alert-triangle'
    | 'circle-check'
    | 'server'
    | 'pencil'
    | 'docker'
}>()
</script>

<template>
  <svg
    class="app-icon"
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'sun'">
      <circle cx="12" cy="12" r="4" />
      <path d="M3 12h1M12 3v1M21 12h-1M12 21v-1M5.6 5.6l.7 .7M18.4 5.6l-.7 .7M17.7 17.7l.7 .7M6.3 17.7l-.7 .7" />
    </template>
    <path
      v-else-if="name === 'moon'"
      d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"
    />
    <path
      v-else-if="name === 'heart'"
      d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572"
    />
    <path
      v-else-if="name === 'github'"
      d="M9 19c-4.3 1.4 -4.3 -2.5 -6 -3m12 5v-3.5c0 -1 .1 -1.4 -.5 -2c2.8 -.3 5.5 -1.4 5.5 -6.1a4.6 4.6 0 0 0 -1.3 -3.2a4.2 4.2 0 0 0 -.1 -3.2s-1.1 -.3 -3.5 1.3a12.3 12.3 0 0 0 -6.2 0c-2.4 -1.6 -3.5 -1.3 -3.5 -1.3a4.2 4.2 0 0 0 -.1 3.2a4.6 4.6 0 0 0 -1.3 3.2c0 4.6 2.7 5.7 5.5 6.1c-.6 .6 -.6 1.2 -.5 2v3.5"
    />
    <template v-else-if="name === 'logout'">
      <path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2" />
      <path d="M9 12h12l-3 -3" />
      <path d="M18 15l3 -3" />
    </template>
    <template v-else-if="name === 'tag'">
      <path d="M7.5 7.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
      <path d="M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592 -5.592a2.41 2.41 0 0 0 0 -3.408l-7.71 -7.71a2 2 0 0 0 -1.414 -.586h-5.172a2 2 0 0 0 -2 2z" />
    </template>
    <template v-else-if="name === 'dashboard'">
      <path d="M5 4h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1z" />
      <path d="M5 16h4a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1z" />
      <path d="M15 12h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1z" />
      <path d="M15 4h4a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1z" />
    </template>
    <template v-else-if="name === 'database-export'">
      <path d="M4 6c0 1.657 3.582 3 8 3s8 -1.343 8 -3s-3.582 -3 -8 -3s-8 1.343 -8 3" />
      <path d="M4 6v6c0 1.657 3.582 3 8 3c.856 0 1.68 -.05 2.454 -.144m5.546 -2.856v-6" />
      <path d="M4 12v6c0 1.657 3.582 3 8 3c.171 0 .341 -.002 .51 -.006m7.49 -6.994v-2" />
      <path d="M16 19h6" />
      <path d="M19 16l3 3l-3 3" />
    </template>
    <path
      v-else-if="name === 'folder'"
      d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2"
    />
    <path
      v-else-if="name === 'cloud'"
      d="M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.642 0 2.974 1.36 2.974 3.038c0 1.679 -1.332 3.038 -2.973 3.038h-12.55"
    />
    <template v-else-if="name === 'trash'">
      <path d="M4 7l16 0" />
      <path d="M10 11l0 6" />
      <path d="M14 11l0 6" />
      <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
      <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
    </template>
    <template v-else-if="name === 'edit'">
      <path d="M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1" />
      <path d="M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415z" />
      <path d="M16 5l3 3" />
    </template>
    <path v-else-if="name === 'play'" d="M7 4v16l13 -8z" />
    <template v-else-if="name === 'bell'">
      <path d="M10 5a2 2 0 0 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6" />
      <path d="M9 17v1a3 3 0 0 0 6 0v-1" />
    </template>
    <template v-else-if="name === 'alert-triangle'">
      <path d="M12 9v4" />
      <path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z" />
      <path d="M12 16h.01" />
    </template>
    <template v-else-if="name === 'circle-check'">
      <path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" />
      <path d="M9 12l2 2l4 -4" />
    </template>
    <template v-else-if="name === 'server'">
      <path d="M3 4m0 3a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v0a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3z" />
      <path d="M3 12m0 3a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v0a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3z" />
      <path d="M7 8l0 .01" />
      <path d="M7 16l0 .01" />
    </template>
    <template v-else-if="name === 'pencil'">
      <path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" />
      <path d="M13.5 6.5l4 4" />
    </template>
    <template v-else-if="name === 'docker'">
      <path d="M22 12.54c-1.7 -.36 -3.5 -.3 -5 .2c.4 -2.16 -.84 -4.41 -2.27 -5.74c-1.5 1.4 -1.93 4.24 -.43 6c-1 .42 -2.1 .6 -3.3 .6h-8.93c-.5 4.84 2.18 9.4 7 9.4c5.7 0 9.9 -2.68 11.95 -8.5c1.5 .1 3 -.38 3.5 -1.9c-.78 -.5 -1.83 -.66 -2.52 -.4z" />
      <path d="M5 10h3v3h-3z" />
      <path d="M8 10h3v3h-3z" />
      <path d="M11 10h3v3h-3z" />
      <path d="M8 7h3v3h-3z" />
      <path d="M11 7h3v3h-3z" />
      <path d="M11 4h3v3h-3z" />
    </template>
    <template v-else-if="name === 'settings'">
      <path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z" />
      <path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />
    </template>
    <template v-else-if="name === 'plug-connected'">
      <path d="M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5z" />
      <path d="M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5z" />
      <path d="M3 21l2.5 -2.5" />
      <path d="M18.5 5.5l2.5 -2.5" />
      <path d="M10 11l-2 2" />
      <path d="M13 14l-2 2" />
    </template>
  </svg>
</template>
