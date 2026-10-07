import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

// Idempotent: applyD1Migrations skips migrations already recorded.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
