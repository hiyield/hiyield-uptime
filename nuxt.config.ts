// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui', '@vueuse/nuxt'],

  devtools: { enabled: false },

  // Internal dashboard behind a login: render client-side only. Avoids SSR/hydration
  // mismatches on live "2m ago" timestamps and keeps session handling simple.
  ssr: false,

  // Pre-bundle Better Auth's client so Vite doesn't re-optimise mid-session.
  vite: {
    optimizeDeps: { include: ['better-auth/vue'] }
  },

  css: ['~/assets/css/main.css'],

  // Light only — status colours carry the meaning; one palette is enough for an internal tool.
  // @ts-expect-error provided by @nuxtjs/color-mode via @nuxt/ui
  colorMode: { preference: 'light', fallback: 'light', classSuffix: '' },
  ui: { colorMode: false },

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Hiyield Uptime'
    }
  },

  ignore: ['**/*.md'],

  // Keep in lock-step with `compatibility_date` in wrangler.jsonc.
  compatibilityDate: '2026-08-25',

  nitro: {
    preset: 'cloudflare-module',
    ignore: ['**/*.md'],
    cloudflare: {
      // wrangler.jsonc is the single source of truth.
      deployConfig: false,
      nodeCompat: true
    }
  },

  typescript: {
    tsConfig: {
      // `wrangler types` output would clobber DOM types in the app program (see qa nuxt.config.ts).
      exclude: ['../worker-configuration.d.ts']
    }
  }
})
