// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/eslint'],
  devtools: { enabled: true },
  css: ['~/assets/css/tokens.css'],
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
