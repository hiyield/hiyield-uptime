import { defineConfig } from 'vitest/config'

/**
 * `unit` — node, no server needed. Pure logic plus DB code against in-memory SQLite
 * built from the real migrations (tests/unit/_db.ts).
 * `integration` is added in Task 8 (Durable Objects inside the Workers runtime).
 *
 * `.nuxt/tsconfig.json` must exist (postinstall runs `nuxt prepare`); run
 * `npx nuxt prepare` by hand if `.nuxt/` was cleaned.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node'
        }
      }
    ]
  }
})
