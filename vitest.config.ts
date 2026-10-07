import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * `unit` — node, no server. Pure logic plus DB code on in-memory SQLite (tests/unit/_db.ts).
 * `integration` — runs inside workerd via @cloudflare/vitest-pool-workers, using
 * wrangler.dev.jsonc (DOs + D1, no Nitro). Migrations are applied in apply-migrations.ts.
 *
 * `.nuxt/tsconfig.json` must exist (postinstall runs `nuxt prepare`).
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
      },
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: here('./wrangler.dev.jsonc') },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations(here('./server/db/migrations')),
                RESEND_API_KEY: 'test-key',
                MAIL_FROM: 'Uptime Test <test@example.com>',
                PUBLIC_BASE_URL: 'https://uptime.test'
              }
            }
          }))
        ],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['./tests/integration/apply-migrations.ts']
        }
      }
    ]
  }
})
