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
