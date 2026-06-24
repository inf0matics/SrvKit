// https://nuxt.com/docs/api/configuration/nuxt-config
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
)

export default defineNuxtConfig({
  modules: ['@nuxt/eslint'],
  devtools: { enabled: true },
  css: ['~/assets/css/tokens.css'],
  // App version, read from package.json at build time, surfaced in the footer.
  runtimeConfig: {
    public: {
      version: pkg.version,
      // Tip Jar link in the app sidebar — hidden when unset.
      tipJarUrl: process.env.TIP_JAR_URL || '',
    },
  },
  // Default theme is Dark; the app shell may switch to light via data-theme.
  app: {
    head: {
      htmlAttrs: { lang: 'en', 'data-theme': 'dark' },
    },
  },
  // Shared lib/ and cli/ use explicit .ts import specifiers so Node can run
  // them natively (unit tests, CLI); allow the same under typecheck.
  typescript: {
    tsConfig: {
      compilerOptions: {
        allowImportingTsExtensions: true,
      },
    },
  },
})
