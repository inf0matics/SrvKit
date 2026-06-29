// https://nuxt.com/docs/api/configuration/nuxt-config
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
)

export default defineNuxtConfig({
  modules: ['@nuxt/eslint'],
  devtools: { enabled: true },
  css: ['~/assets/css/tokens.css'],

  // Don't ship server source maps in the production image (avoids leaking the
  // full TypeScript source if a .map were ever served).
  nitro: {
    sourceMap: false,
  },

  // Baseline HTTP security headers on every response. The CSP allows Nuxt's
  // inline hydration script/styles and the Google Fonts the design system uses;
  // everything else is same-origin only.
  routeRules: {
    '/**': {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Content-Security-Policy': [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data:",
          "connect-src 'self'",
          "frame-ancestors 'self'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; '),
      },
    },
  },

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
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'icon', type: 'image/svg+xml', href: '/srvkit-icon-static.svg' },
      ],
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
