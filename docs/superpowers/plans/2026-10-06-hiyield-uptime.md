# Hiyield Uptime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal uptime monitor for Hiyield client sites: per-site HTTP checks on Cloudflare Durable Objects, two-region failure confirmation, Slack/email alerts with per-site routing, and a Nuxt dashboard behind Google sign-in.

**Architecture:** One Cloudflare Worker hosts a Nuxt 4 app (dashboard + `/api/*`) plus two Durable Object classes. `MonitorDO` (one per monitored site) runs its own alarm loop, calls a pure `evaluate()` state machine, writes history to D1 and sends alerts. `ProbeDO` (one instance, `locationHint: "enam"`) re-checks failures from a second region. All alerting logic is pure and unit-tested; the DO is a thin executor.

**Tech Stack:** Nuxt 4, Nuxt UI 4, Cloudflare Workers + Durable Objects + D1, Drizzle ORM, Better Auth (Google), Resend REST API, Slack incoming webhooks, Zod 4, Vitest 4 + `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-10-06-uptime-monitor-design.md`

**Reference app:** `/Users/loganford/programming/work/webapps/qa` uses the same stack. When a step says "same as qa", that file is the pattern to read.

## Global Constraints

- Node `>=24`. Versions: `nuxt@^4.4.2`, `@nuxt/ui@^4.7.1`, `better-auth@^1.6.10`, `drizzle-orm@^0.45.2`, `tailwindcss@^4.2.4`, `zod@^4.5.4`, `wrangler@^4.125.0`, `vitest@^4.1.11`, `@cloudflare/vitest-pool-workers@^0.22.0`.
- `compatibility_date` is `2026-08-25` in BOTH `nuxt.config.ts` (`compatibilityDate`) and `wrangler.jsonc`.
- Prettier config is copied verbatim from qa: no semicolons, single quotes, `printWidth: 110`, `trailingComma: "none"`.
- Only `@hiyield.co.uk` Google accounts may sign in.
- Check intervals (seconds): `30, 60, 120, 300, 600, 900, 1800`. Default `300`.
- `timeout_ms` default `10000`, allowed `1000–30000`. `fail_threshold` default `2`, allowed `1–10`. `reminder_mins` allowed `0 (off), 15, 30, 60`, default `30`.
- SUSPECT retry cadence: `30s`, regardless of interval.
- Down = HTTP status `>= 400`, timeout, DNS/TLS/connection error. Redirects followed. Method `GET`.
- Alert delivery: up to `3` attempts per contact, backoff `500ms, 1000ms`. Every attempt is a row in `alert_deliveries`.
- Raw `checks` retained `90` days.
- `/health` stale threshold: `max(2 × interval_s, 120s)` since `last_checked_at` (or `created_at` if never checked).
- ProbeDO name `probe-enam`, `locationHint: "enam"`.
- All timestamps in app tables are integer epoch **milliseconds**.
- Code under `server/engine/**`, `shared/**` and any `server/utils/*` file that is unit-tested uses **explicit relative/package imports only** — no Nuxt/Nitro auto-imports, no `~`/`#imports` aliases. (The engine runs in a worker without Nitro; unit tests run without Nitro.)
- Every commit message ends with these two trailer lines:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Y9rygLhSyKkruyMHZnhRJT
  ```

## Review Focus

1. **Pausing a monitor while it is DOWN** — expected: the open incident is resolved silently and state resets, so resuming days later does not send a stale "Recovered after 3d" alert. Test added in Task 8 (`stop() while down resolves incident and clears state`).
2. **Editing a monitor's URL while it is DOWN** — expected: the next healthy check against the new URL resolves the incident and the recovered alert shows the new URL. Test added in Task 8 (`URL edited while down recovers on next ok check`).
3. **Bulk paste from Excel/Windows** — CRLF line endings, blank lines, URLs containing commas in the query string. Expected: parsed correctly, only genuinely bad lines flagged. Tests added in Task 10 (`parseBulk` cases).
4. **Sloppy URL / time input** — leading/trailing whitespace, `HTTPS://` uppercase, maintenance end before start. Expected: URL normalised; maintenance window rejected with a clear message. Tests in Task 10 (`monitorInputSchema`) and Task 11 (`maintenanceSchema`).
5. **Deleting a monitor or contact that has history** — expected: delete succeeds and cascades checks/incidents/deliveries/links without FK errors. Test added in Task 3 (`cascade delete`).

---

## File Map

```
hiyield-uptime/
├── package.json, nuxt.config.ts, tsconfig.json, eslint.config.mjs, .prettierrc, .gitignore, .env.example
├── wrangler.jsonc            # prod/staging Worker (Nitro + DOs + crons)
├── wrangler.dev.jsonc        # dev sidecar + integration-test worker (DOs only, no Nitro)
├── vitest.config.ts          # projects: unit (node), integration (workers pool)
├── .cloudflare/
│   ├── worker.ts             # prod entry: Nitro fetch + DO re-exports + scheduled()
│   └── engine-dev.ts         # dev sidecar entry: DOs only, HTTP forwarding
├── shared/utils/
│   ├── constants.ts          # intervals, defaults, limits
│   ├── email.ts              # isAllowedEmail
│   ├── format.ts             # formatDuration, formatInterval
│   ├── status.ts             # MonitorStatus, displayStatus, STATUS_SORT
│   ├── validation.ts         # zod schemas (monitor, contact, maintenance, test-url)
│   └── bulk.ts               # parseBulk
├── server/
│   ├── db/schema.ts, db/migrations/0001_better_auth.sql, 0002_uptime.sql
│   ├── engine/               # NO Nitro imports
│   │   ├── types.ts, runCheck.ts, evaluate.ts, repo.ts
│   │   ├── notify/message.ts, slack.ts, email.ts, index.ts
│   │   ├── MonitorDO.ts, ProbeDO.ts, probeClient.ts
│   ├── types/cloudflare.d.ts
│   ├── utils/ db.ts, auth.ts, allowedSignup.ts, requireUser.ts, publicPath.ts,
│   │         requireAdminSecret.ts, engine.ts, monitors.ts, contacts.ts, stats.ts
│   ├── middleware/auth.ts
│   ├── routes/health.get.ts
│   └── api/ auth/[...all].ts, monitors/*, contacts/*, maintenance/*, cron/*
├── app/
│   ├── app.vue, app.config.ts, assets/css/main.css
│   ├── layouts/default.vue, middleware/auth.global.ts
│   ├── utils/auth-client.ts, composables/useSessionUser.ts
│   ├── components/ StatusPill.vue, MonitorForm.vue, ResponseChart.vue
│   └── pages/ index.vue, login.vue, contacts.vue, maintenance.vue,
│              monitors/new.vue, monitors/bulk.vue, monitors/[id]/index.vue, monitors/[id]/edit.vue
└── tests/
    ├── unit/ _db.ts, shared.test.ts, schema.test.ts, runCheck.test.ts, evaluate.test.ts,
    │         notify.test.ts, repo.test.ts, auth.test.ts, monitors.test.ts, contacts.test.ts, stats.test.ts
    └── integration/ apply-migrations.ts, env.d.ts, monitor-do.test.ts
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `nuxt.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `.prettierrc`, `.gitignore`, `.env.example`, `wrangler.jsonc`, `vitest.config.ts`, `.cloudflare/worker.ts`, `server/types/cloudflare.d.ts`, `app/app.vue`, `app/app.config.ts`, `app/assets/css/main.css`, `app/pages/index.vue`, `tests/unit/smoke.test.ts`

**Interfaces:**
- Produces: `CloudflareEnv` interface (all bindings/secrets used by later tasks); `npm test` runs the `unit` vitest project; `npm run build` produces `.output/`.

Work in `/Users/loganford/programming/work/webapps/hiyield-uptime` (git repo already exists with the spec committed).

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "hiyield-uptime",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "build": "nuxt build",
    "dev": "npm run db:migrate && nuxt dev",
    "cf:dev": "nuxt build && npm run cf:migrate && wrangler dev --env staging",
    "db:migrate": "wrangler d1 migrations apply hiyield-uptime --local",
    "cf:migrate": "wrangler d1 migrations apply hiyield-uptime-staging --local --env staging",
    "postinstall": "nuxt prepare",
    "lint": "eslint .",
    "format": "prettier --write .",
    "typecheck": "nuxt typecheck",
    "test": "vitest run --project unit",
    "test:watch": "vitest --project unit"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm i nuxt@^4.4.2 @nuxt/ui@^4.7.1 @vueuse/core @vueuse/nuxt better-auth@^1.6.10 drizzle-orm@^0.45.2 tailwindcss@^4.2.4 zod@^4.5.4
npm i -D wrangler@^4.125.0 vitest@^4.1.11 @cloudflare/workers-types typescript vue-tsc eslint @nuxt/eslint prettier eslint-plugin-prettier eslint-config-prettier better-sqlite3 @types/better-sqlite3 concurrently
```

Expected: installs cleanly; `postinstall` runs `nuxt prepare` (it may warn that `nuxt.config.ts` is missing — that's fine, Step 3 creates it, and Step 10 re-runs prepare).

- [ ] **Step 3: Write `nuxt.config.ts`**

```ts
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
```

- [ ] **Step 4: Write `tsconfig.json`, `eslint.config.mjs`, `.prettierrc`, `.gitignore`**

`tsconfig.json`:
```json
{
  "extends": "./.nuxt/tsconfig.json"
}
```

`eslint.config.mjs`:
```js
// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import prettier from 'eslint-plugin-prettier/recommended'

export default withNuxt({ ignores: ['docs/**'] }).append(prettier)
```

`.prettierrc`:
```json
{
  "bracketSpacing": true,
  "printWidth": 110,
  "semi": false,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "none",
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

`.gitignore`:
```
node_modules
*.log
.env
.env.local
.env.*.local
.nuxt
.output
.nitro
.cache
.wrangler
worker-configuration.d.ts
.vscode
.idea
.DS_Store
.claude/settings.local.json
```

- [ ] **Step 5: Write `.env.example`**

```
# Copy to .env for local dev. wrangler dev and nuxt dev both read it.
BETTER_AUTH_SECRET=generate-with-openssl-rand-hex-32
BETTER_AUTH_URL=http://localhost:3000
# Google OAuth client (Hiyield Google Workspace, "Internal" app).
# Authorised redirect URI: http://localhost:3000/api/auth/callback/google
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
RESEND_API_KEY=
MAIL_FROM=Hiyield Uptime <uptime@hiyieldwebapps.co.uk>
PUBLIC_BASE_URL=http://localhost:3000
ADMIN_API_SECRET=generate-with-openssl-rand-hex-32
```

- [ ] **Step 6: Write `wrangler.jsonc`** (Durable Objects and crons are added in Tasks 8 and 12)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",

  // Single source of truth for Worker config. `nuxt build` emits .output/;
  // `wrangler deploy --env staging|production` bundles .cloudflare/worker.ts.
  // Never deploy the top level — it is the `nuxt dev` (Miniflare) config.
  "name": "hiyield-uptime",
  "account_id": "292239b76ae1c8af20ccdc119ce003fb",
  "main": ".cloudflare/worker.ts",
  "compatibility_date": "2026-08-25",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "logs": { "enabled": true, "invocation_logs": true } },
  "assets": { "directory": ".output/public/", "binding": "ASSETS" },
  "workers_dev": false,

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "hiyield-uptime",
      "database_id": "LOCAL_PLACEHOLDER",
      "migrations_dir": "server/db/migrations"
    }
  ],

  "env": {
    "staging": {
      "name": "hiyield-uptime-staging",
      // Internal tool — workers.dev, no custom domain yet (decided at deploy time).
      "workers_dev": true,
      "preview_urls": false,
      "observability": { "logs": { "enabled": true, "invocation_logs": true } },
      "vars": {
        "MAIL_FROM": "Hiyield Uptime <uptime@hiyieldwebapps.co.uk>",
        "PUBLIC_BASE_URL": "https://hiyield-uptime-staging.hiyieldapps.workers.dev",
        "BETTER_AUTH_URL": "https://hiyield-uptime-staging.hiyieldapps.workers.dev"
      },
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "hiyield-uptime-staging",
          "database_id": "FILL_AFTER_WRANGLER_D1_CREATE",
          "migrations_dir": "server/db/migrations"
        }
      ]
    },
    "production": {
      "name": "hiyield-uptime",
      "workers_dev": true,
      "preview_urls": false,
      "observability": { "logs": { "enabled": true, "invocation_logs": true } },
      "vars": {
        "MAIL_FROM": "Hiyield Uptime <uptime@hiyieldwebapps.co.uk>",
        "PUBLIC_BASE_URL": "https://hiyield-uptime.hiyieldapps.workers.dev",
        "BETTER_AUTH_URL": "https://hiyield-uptime.hiyieldapps.workers.dev"
      },
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "hiyield-uptime",
          "database_id": "FILL_AFTER_WRANGLER_D1_CREATE",
          "migrations_dir": "server/db/migrations"
        }
      ]
    }
  }
}
```

- [ ] **Step 7: Write `.cloudflare/worker.ts`**

```ts
/**
 * Worker entry (wrangler `main`). Nitro's cloudflare-module preset only exports
 * `{ fetch }`; this wrapper is where Durable Object classes are re-exported
 * (Task 8) and cron triggers are routed (Task 12).
 *
 * `nuxt dev` never sees this file — see wrangler.dev.jsonc for how DOs run locally.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - emitted by `nuxt build`, may be absent before a build
import nitroHandler from '../.output/server/index.mjs'

export default {
  fetch: nitroHandler.fetch
}
```

- [ ] **Step 8: Write `server/types/cloudflare.d.ts`**

```ts
import type { D1Database, DurableObjectNamespace, ExecutionContext } from '@cloudflare/workers-types'

/**
 * Bindings and secrets on `event.context.cloudflare.env`.
 * Update whenever a binding or `wrangler secret` is added.
 */
export interface CloudflareEnv {
  DB: D1Database

  /**
   * Durable Objects. Optional: they exist in deployed envs and `cf:dev`, but NOT under
   * `nuxt dev` (which runs the Nitro bundle without .cloudflare/worker.ts). See server/utils/engine.ts.
   */
  MONITOR?: DurableObjectNamespace
  PROBE?: DurableObjectNamespace

  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string

  RESEND_API_KEY: string
  MAIL_FROM: string
  PUBLIC_BASE_URL: string

  /** Shared secret for cron → Nitro calls (x-admin-secret header). */
  ADMIN_API_SECRET: string
}

export interface SessionUser {
  id: string
  email: string
  name: string
}

declare module 'h3' {
  interface H3EventContext {
    cloudflare: {
      env: CloudflareEnv
      context: ExecutionContext
      request: Request
    }
    /** Set by server/middleware/auth.ts for every authenticated /api request. */
    user?: SessionUser
  }
}

export {}
```

- [ ] **Step 9: Write the app shell**

`app/app.vue`:
```vue
<template>
  <UApp>
    <NuxtLoadingIndicator color="#0f172a" :height="2" />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
```

`app/app.config.ts`:
```ts
// Primary is slate so that colour is reserved for status (green up, red down, amber suspect).
export default defineAppConfig({
  ui: {
    colors: { primary: 'slate', neutral: 'slate' },
    button: { defaultVariants: { size: 'sm' } }
  }
})
```

`app/assets/css/main.css`:
```css
@import 'tailwindcss';
@import '@nuxt/ui';

@theme {
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
}
```

`app/pages/index.vue` (placeholder, replaced in Task 13):
```vue
<template>
  <div class="p-8 text-lg font-semibold">Hiyield Uptime</div>
</template>
```

- [ ] **Step 10: Write `vitest.config.ts` and a smoke test**

`vitest.config.ts`:
```ts
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
```

`tests/unit/smoke.test.ts`:
```ts
import { describe, expect, it } from 'vitest'

describe('toolchain', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 11: Verify build, lint and tests**

Run:
```bash
npx nuxt prepare && npm test && npm run build && npm run lint
```
Expected: smoke test PASS; `nuxt build` finishes with `.output/server/index.mjs` present; lint exits 0 (run `npm run format` first if Prettier complains).

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: scaffold Nuxt 4 + Cloudflare Worker project"
```

---

### Task 2: Shared constants and helpers

**Files:**
- Create: `shared/utils/constants.ts`, `shared/utils/email.ts`, `shared/utils/format.ts`, `shared/utils/status.ts`
- Test: `tests/unit/shared.test.ts`
- Delete: `tests/unit/smoke.test.ts`

**Interfaces:**
- Produces:
  - `INTERVALS_S: readonly number[]`, `REMINDER_MINS: readonly number[]`, `SUSPECT_RETRY_MS = 30_000`, `CHECK_RETENTION_DAYS = 90`, `ALERT_MAX_ATTEMPTS = 3`, `PROBE_NAME = 'probe-enam'`, `PROBE_LOCATION_HINT = 'enam'`, `MONITOR_DEFAULTS`, `LAUNCH_WATCH`, `ALLOWED_EMAIL_DOMAIN`
  - `isAllowedEmail(email: string): boolean`
  - `formatDuration(ms: number): string`, `formatInterval(seconds: number): string`
  - `type MonitorStatus = 'unknown' | 'up' | 'suspect' | 'down' | 'paused'`, `displayStatus(status, inMaintenance): StatusDisplay`, `STATUS_SORT`

- [ ] **Step 1: Write the failing tests**

`tests/unit/shared.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { isAllowedEmail } from '../../shared/utils/email'
import { formatDuration, formatInterval } from '../../shared/utils/format'
import { displayStatus, STATUS_SORT } from '../../shared/utils/status'
import { INTERVALS_S, MONITOR_DEFAULTS, LAUNCH_WATCH } from '../../shared/utils/constants'

describe('isAllowedEmail', () => {
  it('accepts hiyield.co.uk addresses regardless of case and whitespace', () => {
    expect(isAllowedEmail('logan@hiyield.co.uk')).toBe(true)
    expect(isAllowedEmail('  Logan@HiYield.co.uk ')).toBe(true)
  })
  it('rejects other domains and lookalikes', () => {
    expect(isAllowedEmail('someone@gmail.com')).toBe(false)
    expect(isAllowedEmail('x@evilhiyield.co.uk')).toBe(false)
    expect(isAllowedEmail('x@hiyield.co.uk.evil.com')).toBe(false)
    expect(isAllowedEmail('')).toBe(false)
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [59_000, '59s'],
    [60_000, '1m'],
    [14 * 60_000, '14m'],
    [3_600_000, '1h 0m'],
    [3_660_000, '1h 1m'],
    [25 * 3_600_000, '1d 1h'],
    [-5_000, '0s']
  ])('%i ms → %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })
})

describe('formatInterval', () => {
  it('shows seconds under a minute and minutes above', () => {
    expect(formatInterval(30)).toBe('30s')
    expect(formatInterval(60)).toBe('1m')
    expect(formatInterval(1800)).toBe('30m')
  })
})

describe('displayStatus', () => {
  it('maps stored status to label and colour', () => {
    expect(displayStatus('up', false)).toEqual({ label: 'Up', color: 'success' })
    expect(displayStatus('down', false)).toEqual({ label: 'Down', color: 'error' })
    expect(displayStatus('suspect', false)).toEqual({ label: 'Suspect', color: 'warning' })
    expect(displayStatus('unknown', false)).toEqual({ label: 'Pending', color: 'neutral' })
    expect(displayStatus('paused', false)).toEqual({ label: 'Paused', color: 'neutral' })
  })
  it('shows Maintenance for active windows but Paused wins', () => {
    expect(displayStatus('down', true)).toEqual({ label: 'Maintenance', color: 'info' })
    expect(displayStatus('paused', true)).toEqual({ label: 'Paused', color: 'neutral' })
  })
  it('sorts down first and paused last', () => {
    expect(STATUS_SORT.down).toBeLessThan(STATUS_SORT.suspect)
    expect(STATUS_SORT.suspect).toBeLessThan(STATUS_SORT.up)
    expect(STATUS_SORT.up).toBeLessThan(STATUS_SORT.paused)
  })
})

describe('constants', () => {
  it('match the spec', () => {
    expect([...INTERVALS_S]).toEqual([30, 60, 120, 300, 600, 900, 1800])
    expect(MONITOR_DEFAULTS).toEqual({
      intervalS: 300,
      timeoutMs: 10_000,
      failThreshold: 2,
      reminderMins: 30,
      paused: false
    })
    expect(LAUNCH_WATCH).toEqual({ intervalS: 60, failThreshold: 1 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/shared.test.ts`
Expected: FAIL — cannot resolve `../../shared/utils/email`.

- [ ] **Step 3: Implement**

`shared/utils/constants.ts`:
```ts
/** Values fixed by the design spec. Shared by the engine, the API and the dashboard. */
export const INTERVALS_S: readonly number[] = [30, 60, 120, 300, 600, 900, 1800]
export const REMINDER_MINS: readonly number[] = [0, 15, 30, 60]
export const TIMEOUT_MS_MIN = 1_000
export const TIMEOUT_MS_MAX = 30_000
export const FAIL_THRESHOLD_MIN = 1
export const FAIL_THRESHOLD_MAX = 10

/** A SUSPECT monitor re-checks this soon, whatever its interval. */
export const SUSPECT_RETRY_MS = 30_000
export const CHECK_RETENTION_DAYS = 90
export const ALERT_MAX_ATTEMPTS = 3

export const PROBE_NAME = 'probe-enam'
export const PROBE_LOCATION_HINT = 'enam'

export const MONITOR_DEFAULTS = {
  intervalS: 300,
  timeoutMs: 10_000,
  failThreshold: 2,
  reminderMins: 30,
  paused: false
} as const

/** "Launch watch" preset for newly launched sites. */
export const LAUNCH_WATCH = { intervalS: 60, failThreshold: 1 } as const

export const ALLOWED_EMAIL_DOMAIN = 'hiyield.co.uk'
```

`shared/utils/email.ts`:
```ts
import { ALLOWED_EMAIL_DOMAIN } from './constants'

export function isAllowedEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)
}
```

`shared/utils/format.ts`:
```ts
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

export function formatInterval(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${seconds / 60}m`
}
```

`shared/utils/status.ts`:
```ts
export type MonitorStatus = 'unknown' | 'up' | 'suspect' | 'down' | 'paused'

export interface StatusDisplay {
  label: 'Up' | 'Down' | 'Suspect' | 'Pending' | 'Paused' | 'Maintenance'
  color: 'success' | 'error' | 'warning' | 'neutral' | 'info'
}

/** "Maintenance" is derived from an active window, never stored in monitors.status. */
export function displayStatus(status: MonitorStatus, inMaintenance: boolean): StatusDisplay {
  if (status === 'paused') return { label: 'Paused', color: 'neutral' }
  if (inMaintenance) return { label: 'Maintenance', color: 'info' }
  switch (status) {
    case 'up':
      return { label: 'Up', color: 'success' }
    case 'down':
      return { label: 'Down', color: 'error' }
    case 'suspect':
      return { label: 'Suspect', color: 'warning' }
    default:
      return { label: 'Pending', color: 'neutral' }
  }
}

export const STATUS_SORT: Record<MonitorStatus, number> = {
  down: 0,
  suspect: 1,
  unknown: 2,
  up: 3,
  paused: 4
}
```

Delete `tests/unit/smoke.test.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all `shared.test.ts` cases).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add shared constants, email rule, formatting and status helpers"
```

---

### Task 3: Database schema and migrations

**Files:**
- Create: `server/db/migrations/0001_better_auth.sql`, `server/db/migrations/0002_uptime.sql`, `server/db/schema.ts`, `server/utils/db.ts`, `tests/unit/_db.ts`
- Test: `tests/unit/schema.test.ts`

**Interfaces:**
- Consumes: `MonitorStatus` from `shared/utils/status.ts`
- Produces:
  - Drizzle tables: `monitors`, `contacts`, `monitorContacts`, `checks`, `incidents`, `maintenanceWindows`, `alertDeliveries` (TS camelCase fields, SQL snake_case columns)
  - Row types: `MonitorRow`, `ContactRow`, `CheckRow`, `IncidentRow`, `MaintenanceRow`, `DeliveryRow`
  - `type Db = DrizzleD1Database<typeof schema>`; `useDb(event: H3Event): Db`
  - Test helpers: `makeDb(): Db`, `seedMonitor(db, overrides?)`, `seedContact(db, overrides?)`, `T0 = 1_700_000_000_000`

- [ ] **Step 1: Copy the Better Auth migration from qa**

```bash
cp /Users/loganford/programming/work/webapps/qa/server/db/migrations/0001_better_auth.sql server/db/migrations/0001_better_auth.sql
```

It creates `user`, `session`, `account`, `verification` (Better Auth core schema, no plugins). Open it and confirm it has no Stripe/referral columns — the qa copy has none in 0001.

- [ ] **Step 2: Write `server/db/migrations/0002_uptime.sql`**

```sql
-- App tables. Timestamps are integer epoch milliseconds. Booleans are 0/1.

create table monitors (
  id text primary key,
  name text not null,
  url text not null,
  interval_s integer not null default 300,
  timeout_ms integer not null default 10000,
  fail_threshold integer not null default 2,
  reminder_mins integer not null default 30,
  paused integer not null default 0,
  status text not null default 'unknown',
  consecutive_failures integer not null default 0,
  last_checked_at integer,
  last_response_ms integer,
  last_status_code integer,
  created_at integer not null,
  updated_at integer not null
);

create table contacts (
  id text primary key,
  name text not null,
  type text not null check (type in ('slack', 'email')),
  target text not null,
  is_default integer not null default 0,
  created_at integer not null
);

create table monitor_contacts (
  monitor_id text not null references monitors (id) on delete cascade,
  contact_id text not null references contacts (id) on delete cascade,
  primary key (monitor_id, contact_id)
);

create table checks (
  id integer primary key autoincrement,
  monitor_id text not null references monitors (id) on delete cascade,
  checked_at integer not null,
  ok integer not null,
  status_code integer,
  response_ms integer,
  error text,
  region text not null check (region in ('primary', 'probe')),
  confirmed integer not null default 0,
  maintenance integer not null default 0
);
create index checks_monitor_time on checks (monitor_id, checked_at);
create index checks_time on checks (checked_at);

create table incidents (
  id text primary key,
  monitor_id text not null references monitors (id) on delete cascade,
  started_at integer not null,
  confirmed_at integer not null,
  resolved_at integer,
  cause text not null,
  last_reminder_at integer
);
create index incidents_monitor on incidents (monitor_id, started_at);

create table maintenance_windows (
  id text primary key,
  monitor_id text references monitors (id) on delete cascade,
  starts_at integer not null,
  ends_at integer not null,
  note text not null default '',
  created_by text not null,
  created_at integer not null
);
create index maintenance_active on maintenance_windows (starts_at, ends_at);

create table alert_deliveries (
  id text primary key,
  incident_id text references incidents (id) on delete cascade,
  monitor_id text references monitors (id) on delete cascade,
  contact_id text not null references contacts (id) on delete cascade,
  kind text not null check (kind in ('down', 'reminder', 'recovered', 'test')),
  attempt integer not null,
  ok integer not null,
  error text,
  sent_at integer not null
);
create index deliveries_monitor on alert_deliveries (monitor_id, sent_at);
```

(`alert_deliveries.monitor_id` is an addition to the spec's table so the site page can list deliveries without a join through incidents; test alerts have both `incident_id` and `monitor_id` null.)

- [ ] **Step 3: Write `server/db/schema.ts`**

```ts
import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core'
import type { MonitorStatus } from '../../shared/utils/status'

/**
 * Drizzle schema for app tables. Mirrors server/db/migrations/0002_uptime.sql —
 * the SQL files are the source of truth; keep this in lock-step.
 * Better Auth's tables (0001) are not declared: only Better Auth touches them.
 */

export const monitors = sqliteTable('monitors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  intervalS: integer('interval_s').notNull().default(300),
  timeoutMs: integer('timeout_ms').notNull().default(10000),
  failThreshold: integer('fail_threshold').notNull().default(2),
  reminderMins: integer('reminder_mins').notNull().default(30),
  paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
  status: text('status').$type<MonitorStatus>().notNull().default('unknown'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lastCheckedAt: integer('last_checked_at'),
  lastResponseMs: integer('last_response_ms'),
  lastStatusCode: integer('last_status_code'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').$type<'slack' | 'email'>().notNull(),
  target: text('target').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull()
})

export const monitorContacts = sqliteTable(
  'monitor_contacts',
  {
    monitorId: text('monitor_id')
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' })
  },
  (t) => [primaryKey({ columns: [t.monitorId, t.contactId] })]
)

export const checks = sqliteTable('checks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  monitorId: text('monitor_id')
    .notNull()
    .references(() => monitors.id, { onDelete: 'cascade' }),
  checkedAt: integer('checked_at').notNull(),
  ok: integer('ok', { mode: 'boolean' }).notNull(),
  statusCode: integer('status_code'),
  responseMs: integer('response_ms'),
  error: text('error'),
  region: text('region').$type<'primary' | 'probe'>().notNull(),
  confirmed: integer('confirmed', { mode: 'boolean' }).notNull().default(false),
  maintenance: integer('maintenance', { mode: 'boolean' }).notNull().default(false)
})

export const incidents = sqliteTable('incidents', {
  id: text('id').primaryKey(),
  monitorId: text('monitor_id')
    .notNull()
    .references(() => monitors.id, { onDelete: 'cascade' }),
  startedAt: integer('started_at').notNull(),
  confirmedAt: integer('confirmed_at').notNull(),
  resolvedAt: integer('resolved_at'),
  cause: text('cause').notNull(),
  lastReminderAt: integer('last_reminder_at')
})

export const maintenanceWindows = sqliteTable('maintenance_windows', {
  id: text('id').primaryKey(),
  monitorId: text('monitor_id').references(() => monitors.id, { onDelete: 'cascade' }),
  startsAt: integer('starts_at').notNull(),
  endsAt: integer('ends_at').notNull(),
  note: text('note').notNull().default(''),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull()
})

export const alertDeliveries = sqliteTable('alert_deliveries', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').references(() => incidents.id, { onDelete: 'cascade' }),
  monitorId: text('monitor_id').references(() => monitors.id, { onDelete: 'cascade' }),
  contactId: text('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'down' | 'reminder' | 'recovered' | 'test'>().notNull(),
  attempt: integer('attempt').notNull(),
  ok: integer('ok', { mode: 'boolean' }).notNull(),
  error: text('error'),
  sentAt: integer('sent_at').notNull()
})

export type MonitorRow = typeof monitors.$inferSelect
export type ContactRow = typeof contacts.$inferSelect
export type CheckRow = typeof checks.$inferSelect
export type IncidentRow = typeof incidents.$inferSelect
export type MaintenanceRow = typeof maintenanceWindows.$inferSelect
export type DeliveryRow = typeof alertDeliveries.$inferSelect
```

- [ ] **Step 4: Write `server/utils/db.ts`**

```ts
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import { createError, type H3Event } from 'h3'
import * as schema from '../db/schema'

export type Db = DrizzleD1Database<typeof schema>

/** Bindings are request-scoped on Workers — build the client per request. */
export const useDb = (event: H3Event): Db => {
  const env = event.context.cloudflare?.env
  if (!env?.DB) {
    throw createError({ statusCode: 500, statusMessage: 'D1 binding DB not found' })
  }
  return drizzle(env.DB, { schema })
}
```

- [ ] **Step 5: Write `tests/unit/_db.ts`**

```ts
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../server/db/schema'
import type { Db } from '../../server/utils/db'

/**
 * In-memory SQLite built from the REAL migrations (same approach as qa's tests/unit/_db.ts).
 * better-sqlite3 stands in for D1 — same dialect; the cast is the whole substitution.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

export const T0 = 1_700_000_000_000

export function makeDb(): Db {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const dir = join(root, 'server/db/migrations')
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.sql')) continue
    try {
      sqlite.exec(readFileSync(join(dir, file), 'utf8'))
    } catch (e) {
      throw new Error(`migration ${file} failed: ${(e as Error).message}`)
    }
  }
  return drizzle(sqlite, { schema }) as unknown as Db
}

let seq = 0

export async function seedMonitor(db: Db, overrides: Partial<typeof schema.monitors.$inferInsert> = {}) {
  seq += 1
  const row = {
    id: `mon_${seq}`,
    name: `Site ${seq}`,
    url: `https://site${seq}.example/`,
    createdAt: T0,
    updatedAt: T0,
    ...overrides
  }
  await db.insert(schema.monitors).values(row)
  return row
}

export async function seedContact(db: Db, overrides: Partial<typeof schema.contacts.$inferInsert> = {}) {
  seq += 1
  const row = {
    id: `con_${seq}`,
    name: `Contact ${seq}`,
    type: 'slack' as const,
    target: `https://hooks.slack.com/services/T000/B000/${seq}abcdef`,
    createdAt: T0,
    ...overrides
  }
  await db.insert(schema.contacts).values(row)
  return row
}

export { schema }
```

- [ ] **Step 6: Write the failing schema tests**

`tests/unit/schema.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeDb, seedContact, seedMonitor, schema, T0 } from './_db'

describe('schema', () => {
  it('applies migrations and fills monitor defaults', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    const row = await db.query.monitors.findFirst({ where: eq(schema.monitors.id, m.id) })
    expect(row).toMatchObject({
      intervalS: 300,
      timeoutMs: 10000,
      failThreshold: 2,
      reminderMins: 30,
      paused: false,
      status: 'unknown',
      consecutiveFailures: 0,
      lastCheckedAt: null
    })
  })

  it('rejects unknown contact types', async () => {
    const db = makeDb()
    await expect(seedContact(db, { type: 'sms' as never })).rejects.toThrow()
  })

  it('cascade delete: removing a monitor removes its history and links', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    const c = await seedContact(db)
    await db.insert(schema.monitorContacts).values({ monitorId: m.id, contactId: c.id })
    await db.insert(schema.checks).values({ monitorId: m.id, checkedAt: T0, ok: false, region: 'primary' })
    await db
      .insert(schema.incidents)
      .values({ id: 'inc_1', monitorId: m.id, startedAt: T0, confirmedAt: T0, cause: 'HTTP 503' })
    await db.insert(schema.alertDeliveries).values({
      id: 'del_1',
      incidentId: 'inc_1',
      monitorId: m.id,
      contactId: c.id,
      kind: 'down',
      attempt: 1,
      ok: true,
      sentAt: T0
    })
    await db.insert(schema.maintenanceWindows).values({
      id: 'mw_1',
      monitorId: m.id,
      startsAt: T0,
      endsAt: T0 + 1,
      createdBy: 'a@hiyield.co.uk',
      createdAt: T0
    })

    await db.delete(schema.monitors).where(eq(schema.monitors.id, m.id))

    expect(await db.select().from(schema.checks)).toHaveLength(0)
    expect(await db.select().from(schema.incidents)).toHaveLength(0)
    expect(await db.select().from(schema.alertDeliveries)).toHaveLength(0)
    expect(await db.select().from(schema.monitorContacts)).toHaveLength(0)
    expect(await db.select().from(schema.maintenanceWindows)).toHaveLength(0)
    expect(await db.select().from(schema.contacts)).toHaveLength(1)
  })

  it('cascade delete: removing a contact removes its links and deliveries', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    const c = await seedContact(db)
    await db.insert(schema.monitorContacts).values({ monitorId: m.id, contactId: c.id })
    await db.insert(schema.alertDeliveries).values({
      id: 'del_2',
      contactId: c.id,
      kind: 'test',
      attempt: 1,
      ok: false,
      error: 'Slack responded 404',
      sentAt: T0
    })
    await db.delete(schema.contacts).where(eq(schema.contacts.id, c.id))
    expect(await db.select().from(schema.monitorContacts)).toHaveLength(0)
    expect(await db.select().from(schema.alertDeliveries)).toHaveLength(0)
    expect(await db.select().from(schema.monitors)).toHaveLength(1)
  })
})
```

- [ ] **Step 7: Run tests**

Run: `npm test -- tests/unit/schema.test.ts`
Expected: PASS. (Steps 1–5 are already written; if any test fails, fix the migration/schema mismatch it names — the test is the spec.)

- [ ] **Step 8: Verify migrations apply to local D1**

Run: `npm run db:migrate`
Expected: wrangler lists `0001_better_auth.sql` and `0002_uptime.sql` as applied with ✅.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add D1 schema, migrations and test database helper"
```

---
### Task 4: Engine types and `runCheck`

**Files:**
- Create: `server/engine/types.ts`, `server/engine/runCheck.ts`
- Test: `tests/unit/runCheck.test.ts`

**Interfaces:**
- Consumes: `MonitorStatus` from `shared/utils/status.ts`
- Produces (`server/engine/types.ts`):
  ```ts
  type FetchFn = (input: string, init?: RequestInit) => Promise<Response>
  interface CheckResult { ok: boolean; statusCode: number | null; responseMs: number | null; error: string | null; checkedAt: number }
  interface MonitorConfig { id: string; name: string; url: string; intervalS: number; timeoutMs: number; failThreshold: number; reminderMins: number; paused: boolean }
  interface MonitorState { status: MonitorStatus; consecutiveFailures: number; firstFailureAt: number | null; openIncidentId: string | null; incidentConfirmedAt: number | null; lastReminderAt: number | null }
  type Action = openIncident | resolveIncident | markReminder | alert   // see code
  interface Contact { id: string; name: string; type: 'slack' | 'email'; target: string }
  type AlertKind = 'down' | 'reminder' | 'recovered' | 'test'
  interface AlertEvent { kind: AlertKind; monitor: { id: string; name: string; url: string } | null; cause: string | null; downForMs: number | null; dashboardUrl: string }
  interface AttemptRecord { attempt: number; ok: boolean; error: string | null }
  interface DeliveryResult { ok: boolean; attempts: number; error: string | null }
  ```
- Produces (`server/engine/runCheck.ts`): `runCheck(url: string, opts: { timeoutMs: number; fetch?: FetchFn; now?: () => number }): Promise<CheckResult>` — never throws; `classifyError(err: unknown, timeoutMs: number): string`; `USER_AGENT`.

- [ ] **Step 1: Write `server/engine/types.ts`**

```ts
import type { MonitorStatus } from '../../shared/utils/status'

export type { MonitorStatus }

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

export interface CheckResult {
  ok: boolean
  statusCode: number | null
  responseMs: number | null
  error: string | null
  checkedAt: number
}

export interface MonitorConfig {
  id: string
  name: string
  url: string
  intervalS: number
  timeoutMs: number
  failThreshold: number
  reminderMins: number
  paused: boolean
}

/** Persisted in MonitorDO storage under the key `state`. */
export interface MonitorState {
  status: MonitorStatus
  consecutiveFailures: number
  firstFailureAt: number | null
  openIncidentId: string | null
  incidentConfirmedAt: number | null
  lastReminderAt: number | null
}

export type Action =
  | { type: 'openIncident'; incidentId: string; startedAt: number; confirmedAt: number; cause: string }
  | { type: 'resolveIncident'; incidentId: string; resolvedAt: number }
  | { type: 'markReminder'; incidentId: string; at: number }
  | {
      type: 'alert'
      kind: 'down' | 'reminder' | 'recovered'
      incidentId: string
      cause: string | null
      downForMs: number
    }

export interface Contact {
  id: string
  name: string
  type: 'slack' | 'email'
  target: string
}

export type AlertKind = 'down' | 'reminder' | 'recovered' | 'test'

export interface AlertEvent {
  kind: AlertKind
  /** null only for `test` alerts. */
  monitor: { id: string; name: string; url: string } | null
  cause: string | null
  downForMs: number | null
  dashboardUrl: string
}

export interface AttemptRecord {
  attempt: number
  ok: boolean
  error: string | null
}

export interface DeliveryResult {
  ok: boolean
  attempts: number
  error: string | null
}
```

- [ ] **Step 2: Write the failing tests**

`tests/unit/runCheck.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { classifyError, runCheck, USER_AGENT } from '../../server/engine/runCheck'
import type { FetchFn } from '../../server/engine/types'

const respond =
  (status: number): FetchFn =>
  async () =>
    new Response('body', { status })

const throwing =
  (err: Error): FetchFn =>
  async () => {
    throw err
  }

/** Never resolves on its own; rejects with AbortError when the signal fires — like real fetch. */
const hanging: FetchFn = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })

function clock(...times: number[]) {
  let i = 0
  return () => times[Math.min(i++, times.length - 1)]!
}

describe('runCheck', () => {
  it('2xx is up with status and response time', async () => {
    const r = await runCheck('https://a.example', { timeoutMs: 1000, fetch: respond(200), now: clock(1000, 1250) })
    expect(r).toEqual({ ok: true, statusCode: 200, responseMs: 250, error: null, checkedAt: 1000 })
  })

  it('3xx final status is up', async () => {
    const r = await runCheck('https://a.example', { timeoutMs: 1000, fetch: respond(302) })
    expect(r.ok).toBe(true)
  })

  it('final status after redirects decides: 404 is down', async () => {
    const r = await runCheck('https://a.example', { timeoutMs: 1000, fetch: respond(404) })
    expect(r).toMatchObject({ ok: false, statusCode: 404, error: 'HTTP 404' })
  })

  it('5xx is down', async () => {
    const r = await runCheck('https://a.example', { timeoutMs: 1000, fetch: respond(503) })
    expect(r).toMatchObject({ ok: false, statusCode: 503, error: 'HTTP 503' })
  })

  it('times out', async () => {
    const r = await runCheck('https://a.example', { timeoutMs: 50, fetch: hanging })
    expect(r).toMatchObject({ ok: false, statusCode: null, responseMs: null, error: 'Timeout after 0s' })
  })

  it('DNS failure is down with a readable error', async () => {
    const r = await runCheck('https://a.example', {
      timeoutMs: 1000,
      fetch: throwing(new Error('getaddrinfo ENOTFOUND a.example'))
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^DNS lookup failed/)
  })

  it('TLS failure is down with a readable error', async () => {
    const r = await runCheck('https://a.example', {
      timeoutMs: 1000,
      fetch: throwing(new Error('SSL certificate has expired'))
    })
    expect(r.error).toMatch(/^TLS error/)
  })

  it('sends GET with redirect follow and our user agent', async () => {
    let seen: RequestInit | undefined
    const spy: FetchFn = async (_u, init) => {
      seen = init
      return new Response('', { status: 200 })
    }
    await runCheck('https://a.example', { timeoutMs: 1000, fetch: spy })
    expect(seen?.method).toBe('GET')
    expect(seen?.redirect).toBe('follow')
    expect((seen?.headers as Record<string, string>)['user-agent']).toBe(USER_AGENT)
  })
})

describe('classifyError', () => {
  it('formats timeouts in whole seconds', () => {
    expect(classifyError(new DOMException('x', 'AbortError'), 10_000)).toBe('Timeout after 10s')
  })
  it('falls back to connection error', () => {
    expect(classifyError(new Error('Network connection lost.'), 10_000)).toBe(
      'Connection error: Network connection lost.'
    )
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- tests/unit/runCheck.test.ts`
Expected: FAIL — cannot resolve `../../server/engine/runCheck`.

- [ ] **Step 4: Implement `server/engine/runCheck.ts`**

```ts
import type { CheckResult, FetchFn } from './types'

export const USER_AGENT = 'HiyieldUptime/1.0 (+https://hiyield.co.uk)'

export interface RunCheckOptions {
  timeoutMs: number
  fetch?: FetchFn
  now?: () => number
}

/** One HTTP check. Never throws — every failure becomes a down result with an `error` string. */
export async function runCheck(url: string, opts: RunCheckOptions): Promise<CheckResult> {
  const fetchFn: FetchFn = opts.fetch ?? ((input, init) => fetch(input, init))
  const now = opts.now ?? Date.now
  const started = now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT }
    })
    const responseMs = now() - started
    // Free the connection; we only need the status.
    await res.body?.cancel().catch(() => {})
    const ok = res.status < 400
    return { ok, statusCode: res.status, responseMs, error: ok ? null : `HTTP ${res.status}`, checkedAt: started }
  } catch (err) {
    return {
      ok: false,
      statusCode: null,
      responseMs: null,
      error: classifyError(err, opts.timeoutMs),
      checkedAt: started
    }
  } finally {
    clearTimeout(timer)
  }
}

export function classifyError(err: unknown, timeoutMs: number): string {
  const e = err instanceof Error ? err : new Error(String(err))
  if (e.name === 'AbortError' || e.name === 'TimeoutError') {
    return `Timeout after ${Math.round(timeoutMs / 1000)}s`
  }
  if (/dns|resolve|ENOTFOUND|getaddrinfo/i.test(e.message)) return `DNS lookup failed: ${e.message}`
  if (/tls|ssl|certificate|handshake/i.test(e.message)) return `TLS error: ${e.message}`
  return `Connection error: ${e.message}`
}
```

Note: `DOMException` is not `instanceof Error` in every runtime. If the timeout test fails because `classifyError` wraps the DOMException with `String(err)`, change the first line to read `name` from the raw value:
```ts
const name = (err as { name?: string })?.name
const message = (err as { message?: string })?.message ?? String(err)
```
and use `name`/`message` below. Do this up front if you prefer — the behaviour is the same.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/unit/runCheck.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(engine): add check types and runCheck"
```

---

### Task 5: `evaluate()` state machine

**Files:**
- Create: `server/engine/evaluate.ts`
- Test: `tests/unit/evaluate.test.ts`

**Interfaces:**
- Consumes: `CheckResult`, `MonitorConfig`, `MonitorState`, `Action` (Task 4); `SUSPECT_RETRY_MS` (Task 2)
- Produces:
  ```ts
  interface EvaluateInput { state: MonitorState; config: MonitorConfig; primary: CheckResult; probe: CheckResult | null; inMaintenance: boolean; now: number; newIncidentId: string }
  interface EvaluateResult { nextState: MonitorState; actions: Action[]; nextCheckAt: number }
  function evaluate(input: EvaluateInput): EvaluateResult
  function initialState(): MonitorState
  function causeOf(check: CheckResult): string
  ```

**Rules (from spec §6, made exact):**
- `confirmed` = primary failed AND probe ran AND probe failed. `blip` = primary failed and not confirmed.
- In maintenance: resolve any open incident silently, reset to `up`, normal interval. No alerts ever.
- Primary ok: if `down` with an open incident → `resolveIncident` + `recovered` alert (`downForMs = now − firstFailureAt`). Always reset to `up`.
- Blip: state unchanged; next check in 30s if `suspect`, else normal interval.
- Confirmed while `down`: increment counter; send `reminder` + `markReminder` when `reminderMins > 0` and `now − (lastReminderAt ?? incidentConfirmedAt) ≥ reminderMins`.
- Confirmed, counter reaches `failThreshold`: `openIncident` (startedAt = firstFailureAt) + `down` alert; state `down`.
- Confirmed, below threshold: `suspect`, next check in 30s.

- [ ] **Step 1: Write the failing tests**

`tests/unit/evaluate.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { evaluate, initialState, type EvaluateInput } from '../../server/engine/evaluate'
import type { CheckResult, MonitorConfig, MonitorState } from '../../server/engine/types'

const NOW = 1_700_000_000_000
const MIN = 60_000

const cfg = (o: Partial<MonitorConfig> = {}): MonitorConfig => ({
  id: 'mon_1',
  name: 'Acme',
  url: 'https://acme.example/',
  intervalS: 300,
  timeoutMs: 10_000,
  failThreshold: 2,
  reminderMins: 30,
  paused: false,
  ...o
})

const ok = (): CheckResult => ({ ok: true, statusCode: 200, responseMs: 120, error: null, checkedAt: NOW })
const fail = (error = 'HTTP 503', statusCode: number | null = 503): CheckResult => ({
  ok: false,
  statusCode,
  responseMs: statusCode ? 80 : null,
  error,
  checkedAt: NOW
})

const st = (o: Partial<MonitorState> = {}): MonitorState => ({ ...initialState(), status: 'up', ...o })

const down = (o: Partial<MonitorState> = {}): MonitorState =>
  st({
    status: 'down',
    consecutiveFailures: 2,
    firstFailureAt: NOW - 20 * MIN,
    openIncidentId: 'inc_1',
    incidentConfirmedAt: NOW - 19 * MIN,
    ...o
  })

function run(o: Partial<EvaluateInput>) {
  return evaluate({
    state: st(),
    config: cfg(),
    primary: ok(),
    probe: null,
    inMaintenance: false,
    now: NOW,
    newIncidentId: 'inc_new',
    ...o
  })
}

describe('evaluate — healthy', () => {
  it('unknown + ok → up, no actions, normal interval', () => {
    const r = run({ state: initialState() })
    expect(r.nextState.status).toBe('up')
    expect(r.actions).toEqual([])
    expect(r.nextCheckAt).toBe(NOW + 300_000)
  })

  it('suspect + ok → up, counter reset, no alert', () => {
    const r = run({ state: st({ status: 'suspect', consecutiveFailures: 1, firstFailureAt: NOW - MIN }) })
    expect(r.nextState).toEqual({ ...initialState(), status: 'up' })
    expect(r.actions).toEqual([])
  })
})

describe('evaluate — blips', () => {
  it('up + primary fail + probe ok → unchanged, no actions, normal interval', () => {
    const state = st()
    const r = run({ state, primary: fail(), probe: ok() })
    expect(r.nextState).toEqual(state)
    expect(r.actions).toEqual([])
    expect(r.nextCheckAt).toBe(NOW + 300_000)
  })

  it('suspect + blip → stays suspect on the 30s cadence', () => {
    const state = st({ status: 'suspect', consecutiveFailures: 1, firstFailureAt: NOW - 30_000 })
    const r = run({ state, primary: fail(), probe: ok() })
    expect(r.nextState).toEqual(state)
    expect(r.nextCheckAt).toBe(NOW + 30_000)
  })

  it('down + blip → stays down, no actions', () => {
    const state = down()
    const r = run({ state, primary: fail(), probe: ok() })
    expect(r.nextState).toEqual(state)
    expect(r.actions).toEqual([])
  })
})

describe('evaluate — confirmed failures', () => {
  it('up + confirmed, threshold 2 → suspect, retry in 30s, no alert', () => {
    const r = run({ primary: fail(), probe: fail() })
    expect(r.nextState).toMatchObject({ status: 'suspect', consecutiveFailures: 1, firstFailureAt: NOW })
    expect(r.actions).toEqual([])
    expect(r.nextCheckAt).toBe(NOW + 30_000)
  })

  it('suspect + confirmed reaching threshold → down, incident opened, down alert', () => {
    const firstFailureAt = NOW - 30_000
    const r = run({
      state: st({ status: 'suspect', consecutiveFailures: 1, firstFailureAt }),
      primary: fail(),
      probe: fail()
    })
    expect(r.nextState).toEqual({
      status: 'down',
      consecutiveFailures: 2,
      firstFailureAt,
      openIncidentId: 'inc_new',
      incidentConfirmedAt: NOW,
      lastReminderAt: null
    })
    expect(r.actions).toEqual([
      { type: 'openIncident', incidentId: 'inc_new', startedAt: firstFailureAt, confirmedAt: NOW, cause: 'HTTP 503' },
      { type: 'alert', kind: 'down', incidentId: 'inc_new', cause: 'HTTP 503', downForMs: 30_000 }
    ])
    expect(r.nextCheckAt).toBe(NOW + 300_000)
  })

  it('threshold 1 → down on the first confirmed failure', () => {
    const r = run({ config: cfg({ failThreshold: 1 }), primary: fail(), probe: fail() })
    expect(r.nextState.status).toBe('down')
    expect(r.actions.map((a) => a.type)).toEqual(['openIncident', 'alert'])
  })

  it('site already down when the monitor is created (unknown, threshold 1) → down', () => {
    const r = run({ state: initialState(), config: cfg({ failThreshold: 1 }), primary: fail(), probe: fail() })
    expect(r.nextState.status).toBe('down')
  })

  it('threshold 3 needs three confirmed failures', () => {
    const config = cfg({ failThreshold: 3 })
    const r1 = run({ config, primary: fail(), probe: fail() })
    const r2 = run({ config, state: r1.nextState, primary: fail(), probe: fail() })
    expect(r2.nextState.status).toBe('suspect')
    const r3 = run({ config, state: r2.nextState, primary: fail(), probe: fail() })
    expect(r3.nextState.status).toBe('down')
  })

  it('uses the error text as the cause (timeouts)', () => {
    const r = run({
      config: cfg({ failThreshold: 1 }),
      primary: fail('Timeout after 10s', null),
      probe: fail('Timeout after 10s', null)
    })
    expect(r.actions[0]).toMatchObject({ type: 'openIncident', cause: 'Timeout after 10s' })
  })
})

describe('evaluate — reminders', () => {
  it('no reminder before reminderMins since confirmation', () => {
    const r = run({ state: down({ incidentConfirmedAt: NOW - 10 * MIN }), primary: fail(), probe: fail() })
    expect(r.actions).toEqual([])
    expect(r.nextState.consecutiveFailures).toBe(3)
  })

  it('reminder at reminderMins since confirmation', () => {
    const r = run({ state: down({ incidentConfirmedAt: NOW - 30 * MIN }), primary: fail(), probe: fail() })
    expect(r.actions).toEqual([
      { type: 'alert', kind: 'reminder', incidentId: 'inc_1', cause: 'HTTP 503', downForMs: 20 * MIN },
      { type: 'markReminder', incidentId: 'inc_1', at: NOW }
    ])
    expect(r.nextState.lastReminderAt).toBe(NOW)
  })

  it('next reminder counts from the last reminder', () => {
    const state = down({ incidentConfirmedAt: NOW - 90 * MIN, lastReminderAt: NOW - 20 * MIN })
    expect(run({ state, primary: fail(), probe: fail() }).actions).toEqual([])
    const later = down({ incidentConfirmedAt: NOW - 90 * MIN, lastReminderAt: NOW - 30 * MIN })
    expect(run({ state: later, primary: fail(), probe: fail() }).actions[0]).toMatchObject({ kind: 'reminder' })
  })

  it('reminderMins 0 never reminds', () => {
    const r = run({
      config: cfg({ reminderMins: 0 }),
      state: down({ incidentConfirmedAt: NOW - 600 * MIN }),
      primary: fail(),
      probe: fail()
    })
    expect(r.actions).toEqual([])
  })
})

describe('evaluate — recovery', () => {
  it('down + ok → incident resolved and recovered alert with downtime', () => {
    const r = run({ state: down() })
    expect(r.actions).toEqual([
      { type: 'resolveIncident', incidentId: 'inc_1', resolvedAt: NOW },
      { type: 'alert', kind: 'recovered', incidentId: 'inc_1', cause: null, downForMs: 20 * MIN }
    ])
    expect(r.nextState).toEqual({ ...initialState(), status: 'up' })
    expect(r.nextCheckAt).toBe(NOW + 300_000)
  })
})

describe('evaluate — maintenance', () => {
  it('failures during maintenance never alert or open incidents', () => {
    const r = run({ inMaintenance: true, primary: fail(), probe: fail(), config: cfg({ failThreshold: 1 }) })
    expect(r.actions).toEqual([])
    expect(r.nextState).toEqual({ ...initialState(), status: 'up' })
    expect(r.nextCheckAt).toBe(NOW + 300_000)
  })

  it('maintenance starting mid-incident resolves it silently', () => {
    const r = run({ inMaintenance: true, state: down(), primary: fail(), probe: fail() })
    expect(r.actions).toEqual([{ type: 'resolveIncident', incidentId: 'inc_1', resolvedAt: NOW }])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/evaluate.test.ts`
Expected: FAIL — cannot resolve `../../server/engine/evaluate`.

- [ ] **Step 3: Implement `server/engine/evaluate.ts`**

```ts
import { SUSPECT_RETRY_MS } from '../../shared/utils/constants'
import type { Action, CheckResult, MonitorConfig, MonitorState } from './types'

export interface EvaluateInput {
  state: MonitorState
  config: MonitorConfig
  primary: CheckResult
  /** Result from ProbeDO; null when the primary check passed (probe not consulted). */
  probe: CheckResult | null
  inMaintenance: boolean
  now: number
  /** Pre-generated so this function stays pure; used only if an incident opens. */
  newIncidentId: string
}

export interface EvaluateResult {
  nextState: MonitorState
  actions: Action[]
  nextCheckAt: number
}

export function initialState(): MonitorState {
  return {
    status: 'unknown',
    consecutiveFailures: 0,
    firstFailureAt: null,
    openIncidentId: null,
    incidentConfirmedAt: null,
    lastReminderAt: null
  }
}

const upState = (): MonitorState => ({ ...initialState(), status: 'up' })

export function causeOf(check: CheckResult): string {
  return check.error ?? (check.statusCode ? `HTTP ${check.statusCode}` : 'Unknown error')
}

/** All alerting decisions. Pure: no I/O, no clock, no randomness. */
export function evaluate(input: EvaluateInput): EvaluateResult {
  const { state, config, primary, probe, inMaintenance, now } = input
  const normalNext = now + config.intervalS * 1000
  const actions: Action[] = []

  if (inMaintenance) {
    if (state.openIncidentId) {
      actions.push({ type: 'resolveIncident', incidentId: state.openIncidentId, resolvedAt: now })
    }
    return { nextState: upState(), actions, nextCheckAt: normalNext }
  }

  if (primary.ok) {
    if (state.status === 'down' && state.openIncidentId) {
      const downSince = state.firstFailureAt ?? state.incidentConfirmedAt ?? now
      actions.push({ type: 'resolveIncident', incidentId: state.openIncidentId, resolvedAt: now })
      actions.push({
        type: 'alert',
        kind: 'recovered',
        incidentId: state.openIncidentId,
        cause: null,
        downForMs: now - downSince
      })
    }
    return { nextState: upState(), actions, nextCheckAt: normalNext }
  }

  const confirmed = probe !== null && !probe.ok
  if (!confirmed) {
    return {
      nextState: state,
      actions,
      nextCheckAt: state.status === 'suspect' ? now + SUSPECT_RETRY_MS : normalNext
    }
  }

  const cause = causeOf(primary)
  const consecutiveFailures = state.consecutiveFailures + 1
  const firstFailureAt = state.firstFailureAt ?? now

  if (state.status === 'down' && state.openIncidentId) {
    const nextState: MonitorState = { ...state, consecutiveFailures, firstFailureAt }
    const lastNotified = state.lastReminderAt ?? state.incidentConfirmedAt ?? now
    if (config.reminderMins > 0 && now - lastNotified >= config.reminderMins * 60_000) {
      actions.push({
        type: 'alert',
        kind: 'reminder',
        incidentId: state.openIncidentId,
        cause,
        downForMs: now - firstFailureAt
      })
      actions.push({ type: 'markReminder', incidentId: state.openIncidentId, at: now })
      nextState.lastReminderAt = now
    }
    return { nextState, actions, nextCheckAt: normalNext }
  }

  if (consecutiveFailures >= config.failThreshold) {
    const incidentId = input.newIncidentId
    actions.push({ type: 'openIncident', incidentId, startedAt: firstFailureAt, confirmedAt: now, cause })
    actions.push({ type: 'alert', kind: 'down', incidentId, cause, downForMs: now - firstFailureAt })
    return {
      nextState: {
        status: 'down',
        consecutiveFailures,
        firstFailureAt,
        openIncidentId: incidentId,
        incidentConfirmedAt: now,
        lastReminderAt: null
      },
      actions,
      nextCheckAt: normalNext
    }
  }

  return {
    nextState: { ...state, status: 'suspect', consecutiveFailures, firstFailureAt },
    actions,
    nextCheckAt: now + SUSPECT_RETRY_MS
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/evaluate.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): add evaluate() alerting state machine"
```

---

### Task 6: Notifier (Slack + email)

**Files:**
- Create: `server/engine/notify/message.ts`, `server/engine/notify/slack.ts`, `server/engine/notify/email.ts`, `server/engine/notify/index.ts`
- Test: `tests/unit/notify.test.ts`

**Interfaces:**
- Consumes: `AlertEvent`, `Contact`, `AttemptRecord`, `DeliveryResult`, `FetchFn` (Task 4); `formatDuration`, `ALERT_MAX_ATTEMPTS` (Task 2)
- Produces:
  ```ts
  buildMessage(e: AlertEvent): { title: string; lines: string[]; tone: 'danger' | 'good' | 'neutral' }
  slackPayload(e: AlertEvent): object;  deliverSlack(fetch: FetchFn, webhookUrl: string, payload: unknown): Promise<void>
  emailPayload(e: AlertEvent, from: string, to: string): { from; to: string[]; subject; html; text };  deliverEmail(fetch, apiKey, payload): Promise<void>
  type SendAlert = (contact: Contact, event: AlertEvent, onAttempt?: (r: AttemptRecord) => Promise<void>) => Promise<DeliveryResult>
  createSender(deps: { fetch: FetchFn; resendApiKey: string; mailFrom: string; sleep?: (ms: number) => Promise<void>; maxAttempts?: number }): SendAlert
  ```

- [ ] **Step 1: Write the failing tests**

`tests/unit/notify.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { buildMessage } from '../../server/engine/notify/message'
import { slackPayload } from '../../server/engine/notify/slack'
import { emailPayload } from '../../server/engine/notify/email'
import { createSender } from '../../server/engine/notify'
import type { AlertEvent, AttemptRecord, Contact, FetchFn } from '../../server/engine/types'

const monitor = { id: 'mon_1', name: 'Acme', url: 'https://acme.example/' }
const dashboardUrl = 'https://uptime.test/monitors/mon_1'

const ev = (o: Partial<AlertEvent>): AlertEvent => ({
  kind: 'down',
  monitor,
  cause: 'HTTP 503',
  downForMs: 60_000,
  dashboardUrl,
  ...o
})

const slack: Contact = { id: 'c1', name: '#dev', type: 'slack', target: 'https://hooks.slack.com/services/x' }
const email: Contact = { id: 'c2', name: 'Logan', type: 'email', target: 'logan@hiyield.co.uk' }

describe('buildMessage', () => {
  it('down', () => {
    expect(buildMessage(ev({}))).toEqual({
      title: '🔴 Acme is DOWN',
      lines: ['URL: https://acme.example/', 'Error: HTTP 503', 'Failing for: 1m', `Dashboard: ${dashboardUrl}`],
      tone: 'danger'
    })
  })
  it('reminder', () => {
    const m = buildMessage(ev({ kind: 'reminder', downForMs: 45 * 60_000 }))
    expect(m.title).toBe('🔴 Acme is still DOWN')
    expect(m.lines).toContain('Down for: 45m')
  })
  it('recovered', () => {
    const m = buildMessage(ev({ kind: 'recovered', cause: null, downForMs: 14 * 60_000 }))
    expect(m).toEqual({
      title: '🟢 Acme has RECOVERED',
      lines: ['URL: https://acme.example/', 'Was down for: 14m', `Dashboard: ${dashboardUrl}`],
      tone: 'good'
    })
  })
  it('test', () => {
    const m = buildMessage(ev({ kind: 'test', monitor: null, cause: null, downForMs: null }))
    expect(m.title).toBe('🧪 Test alert from Hiyield Uptime')
    expect(m.tone).toBe('neutral')
    expect(m.lines[0]).toMatch(/alerts to this contact work/)
  })
})

describe('slackPayload', () => {
  it('uses red for down and green for recovered', () => {
    const down = slackPayload(ev({})) as { text: string; attachments: { color: string }[] }
    expect(down.text).toBe('🔴 Acme is DOWN')
    expect(down.attachments[0]!.color).toBe('#e11d48')
    const up = slackPayload(ev({ kind: 'recovered', cause: null })) as { attachments: { color: string }[] }
    expect(up.attachments[0]!.color).toBe('#059669')
  })
})

describe('emailPayload', () => {
  it('drops the emoji from the subject and escapes HTML', () => {
    const p = emailPayload(
      ev({ monitor: { ...monitor, name: '<script>x</script>' } }),
      'Uptime <u@x.test>',
      'a@hiyield.co.uk'
    )
    expect(p.subject).toBe('<script>x</script> is DOWN')
    expect(p.to).toEqual(['a@hiyield.co.uk'])
    expect(p.html).not.toContain('<script>')
    expect(p.html).toContain('&lt;script&gt;')
    expect(p.text).toContain('Error: HTTP 503')
  })
})

describe('createSender', () => {
  const noSleep = async () => {}

  it('posts Slack payloads to the webhook', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetch: FetchFn = async (url, init) => {
      calls.push({ url, init })
      return new Response('ok', { status: 200 })
    }
    const send = createSender({ fetch, resendApiKey: 'rk', mailFrom: 'f@x.test', sleep: noSleep })
    const r = await send(slack, ev({}))
    expect(r).toEqual({ ok: true, attempts: 1, error: null })
    expect(calls[0]!.url).toBe(slack.target)
    expect(JSON.parse(calls[0]!.init!.body as string).text).toBe('🔴 Acme is DOWN')
  })

  it('posts email to Resend with a bearer key', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetch: FetchFn = async (url, init) => {
      calls.push({ url, init })
      return new Response('{"id":"e1"}', { status: 200 })
    }
    const send = createSender({ fetch, resendApiKey: 'rk', mailFrom: 'f@x.test', sleep: noSleep })
    await send(email, ev({}))
    expect(calls[0]!.url).toBe('https://api.resend.com/emails')
    expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe('Bearer rk')
    expect(JSON.parse(calls[0]!.init!.body as string).to).toEqual(['logan@hiyield.co.uk'])
  })

  it('retries failures and reports every attempt', async () => {
    let n = 0
    const fetch: FetchFn = async () => {
      n += 1
      return n < 3 ? new Response('nope', { status: 500 }) : new Response('ok', { status: 200 })
    }
    const sleeps: number[] = []
    const attempts: AttemptRecord[] = []
    const send = createSender({
      fetch,
      resendApiKey: 'rk',
      mailFrom: 'f@x.test',
      sleep: async (ms) => {
        sleeps.push(ms)
      }
    })
    const r = await send(slack, ev({}), async (a) => {
      attempts.push(a)
    })
    expect(r).toEqual({ ok: true, attempts: 3, error: null })
    expect(attempts.map((a) => a.ok)).toEqual([false, false, true])
    expect(attempts[0]!.error).toBe('Slack responded 500: nope')
    expect(sleeps).toEqual([500, 1000])
  })

  it('gives up after 3 attempts with the last error', async () => {
    const fetch: FetchFn = async () => new Response('invalid_token', { status: 404 })
    const send = createSender({ fetch, resendApiKey: 'rk', mailFrom: 'f@x.test', sleep: noSleep })
    const r = await send(slack, ev({}))
    expect(r).toEqual({ ok: false, attempts: 3, error: 'Slack responded 404: invalid_token' })
  })

  it('treats a thrown fetch as a failed attempt', async () => {
    const fetch: FetchFn = async () => {
      throw new Error('Network connection lost.')
    }
    const send = createSender({ fetch, resendApiKey: 'rk', mailFrom: 'f@x.test', sleep: noSleep, maxAttempts: 1 })
    expect(await send(email, ev({}))).toEqual({ ok: false, attempts: 1, error: 'Network connection lost.' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/notify.test.ts`
Expected: FAIL — cannot resolve `../../server/engine/notify/message`.

- [ ] **Step 3: Implement**

`server/engine/notify/message.ts`:
```ts
import { formatDuration } from '../../../shared/utils/format'
import type { AlertEvent } from '../types'

export interface AlertMessage {
  title: string
  lines: string[]
  tone: 'danger' | 'good' | 'neutral'
}

/** Channel-neutral alert content. Slack and email both render from this. */
export function buildMessage(e: AlertEvent): AlertMessage {
  const lines: string[] = e.monitor ? [`URL: ${e.monitor.url}`] : []
  const name = e.monitor?.name ?? ''
  switch (e.kind) {
    case 'down':
      if (e.cause) lines.push(`Error: ${e.cause}`)
      if (e.downForMs !== null) lines.push(`Failing for: ${formatDuration(e.downForMs)}`)
      lines.push(`Dashboard: ${e.dashboardUrl}`)
      return { title: `🔴 ${name} is DOWN`, lines, tone: 'danger' }
    case 'reminder':
      if (e.cause) lines.push(`Error: ${e.cause}`)
      if (e.downForMs !== null) lines.push(`Down for: ${formatDuration(e.downForMs)}`)
      lines.push(`Dashboard: ${e.dashboardUrl}`)
      return { title: `🔴 ${name} is still DOWN`, lines, tone: 'danger' }
    case 'recovered':
      lines.push(`Was down for: ${formatDuration(e.downForMs ?? 0)}`)
      lines.push(`Dashboard: ${e.dashboardUrl}`)
      return { title: `🟢 ${name} has RECOVERED`, lines, tone: 'good' }
    case 'test':
      return {
        title: '🧪 Test alert from Hiyield Uptime',
        lines: [
          'This is a test alert from Hiyield Uptime. If you can read this, alerts to this contact work.',
          `Dashboard: ${e.dashboardUrl}`
        ],
        tone: 'neutral'
      }
  }
}
```

`server/engine/notify/slack.ts`:
```ts
import type { AlertEvent, FetchFn } from '../types'
import { buildMessage } from './message'

const COLORS = { danger: '#e11d48', good: '#059669', neutral: '#64748b' } as const

export function slackPayload(e: AlertEvent) {
  const m = buildMessage(e)
  return {
    text: m.title,
    attachments: [
      {
        color: COLORS[m.tone],
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*${m.title}*\n${m.lines.join('\n')}` } }]
      }
    ]
  }
}

export async function deliverSlack(fetchFn: FetchFn, webhookUrl: string, payload: unknown): Promise<void> {
  const res = await fetchFn(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(`Slack responded ${res.status}: ${(await res.text()).slice(0, 200)}`)
}
```

`server/engine/notify/email.ts`:
```ts
import type { AlertEvent, FetchFn } from '../types'
import { buildMessage } from './message'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function emailPayload(e: AlertEvent, from: string, to: string) {
  const m = buildMessage(e)
  const subject = m.title.replace(/^\S+\s/, '') // drop the leading emoji
  const color = m.tone === 'danger' ? '#e11d48' : m.tone === 'good' ? '#059669' : '#334155'
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#0f172a">
<h2 style="color:${color};margin:0 0 12px">${escapeHtml(subject)}</h2>
<p style="line-height:1.6;margin:0">${m.lines.map(escapeHtml).join('<br>')}</p>
</div>`
  const text = [subject, '', ...m.lines].join('\n')
  return { from, to: [to], subject, html, text }
}

export async function deliverEmail(fetchFn: FetchFn, apiKey: string, payload: unknown): Promise<void> {
  const res = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 200)}`)
}
```

`server/engine/notify/index.ts`:
```ts
import { ALERT_MAX_ATTEMPTS } from '../../../shared/utils/constants'
import type { AlertEvent, AttemptRecord, Contact, DeliveryResult, FetchFn } from '../types'
import { deliverEmail, emailPayload } from './email'
import { deliverSlack, slackPayload } from './slack'

export type SendAlert = (
  contact: Contact,
  event: AlertEvent,
  onAttempt?: (r: AttemptRecord) => Promise<void>
) => Promise<DeliveryResult>

export interface SenderDeps {
  fetch: FetchFn
  resendApiKey: string
  mailFrom: string
  sleep?: (ms: number) => Promise<void>
  maxAttempts?: number
}

/**
 * One function per channel type. Adding SMS later = one new module + one branch here.
 * Retries with 500ms/1000ms backoff; `onAttempt` sees every attempt (recorded as alert_deliveries rows).
 */
export function createSender(deps: SenderDeps): SendAlert {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const max = deps.maxAttempts ?? ALERT_MAX_ATTEMPTS
  return async (contact, event, onAttempt) => {
    let lastError: string | null = null
    for (let attempt = 1; attempt <= max; attempt++) {
      try {
        if (contact.type === 'slack') {
          await deliverSlack(deps.fetch, contact.target, slackPayload(event))
        } else {
          await deliverEmail(deps.fetch, deps.resendApiKey, emailPayload(event, deps.mailFrom, contact.target))
        }
        await onAttempt?.({ attempt, ok: true, error: null })
        return { ok: true, attempts: attempt, error: null }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        await onAttempt?.({ attempt, ok: false, error: lastError })
        if (attempt < max) await sleep(500 * 2 ** (attempt - 1))
      }
    }
    return { ok: false, attempts: max, error: lastError }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/notify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): add Slack and email notifier with retries"
```

---

### Task 7: Engine repository (D1 access)

**Files:**
- Create: `server/engine/repo.ts`
- Test: `tests/unit/repo.test.ts`

**Interfaces:**
- Consumes: schema (Task 3); `MonitorConfig`, `Contact`, `MonitorStatus` (Task 4)
- Produces (all take `db: EngineDb` first):
  ```ts
  type EngineDb = DrizzleD1Database<typeof schema>
  getMonitor(db, id): Promise<MonitorConfig | null>
  isInMaintenance(db, monitorId, now): Promise<boolean>
  insertChecks(db, rows: NewCheck[]): Promise<void>
  insertIncident(db, row: { id; monitorId; startedAt; confirmedAt; cause }): Promise<void>
  resolveIncident(db, id, resolvedAt): Promise<void>          // no-op if already resolved
  resolveOpenIncidents(db, monitorId, resolvedAt): Promise<void>
  setIncidentReminder(db, id, at): Promise<void>
  getContactsForMonitor(db, monitorId): Promise<Contact[]>
  insertDelivery(db, row: NewDelivery): Promise<void>
  updateMonitorStatus(db, id, patch: MonitorStatusPatch): Promise<void>
  ```

- [ ] **Step 1: Write the failing tests**

`tests/unit/repo.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import * as repo from '../../server/engine/repo'
import { makeDb, seedContact, seedMonitor, schema, T0 } from './_db'

describe('repo', () => {
  it('getMonitor maps the row to config, null when missing', async () => {
    const db = makeDb()
    const m = await seedMonitor(db, { intervalS: 60, failThreshold: 1 })
    expect(await repo.getMonitor(db, m.id)).toEqual({
      id: m.id,
      name: m.name,
      url: m.url,
      intervalS: 60,
      timeoutMs: 10000,
      failThreshold: 1,
      reminderMins: 30,
      paused: false
    })
    expect(await repo.getMonitor(db, 'nope')).toBeNull()
  })

  it('isInMaintenance: site window, global window, past and future windows', async () => {
    const db = makeDb()
    const a = await seedMonitor(db)
    const b = await seedMonitor(db)
    const win = (id: string, monitorId: string | null, startsAt: number, endsAt: number) =>
      db.insert(schema.maintenanceWindows).values({
        id,
        monitorId,
        startsAt,
        endsAt,
        createdBy: 'x@hiyield.co.uk',
        createdAt: T0
      })
    await win('w1', a.id, T0 - 1000, T0 + 1000)
    expect(await repo.isInMaintenance(db, a.id, T0)).toBe(true)
    expect(await repo.isInMaintenance(db, b.id, T0)).toBe(false)
    expect(await repo.isInMaintenance(db, a.id, T0 + 1000)).toBe(false) // end is exclusive
    await win('w2', null, T0 + 5000, T0 + 9000)
    expect(await repo.isInMaintenance(db, b.id, T0 + 6000)).toBe(true) // global
    expect(await repo.isInMaintenance(db, b.id, T0 + 4999)).toBe(false) // not started
  })

  it('insertChecks writes rows and ignores an empty list', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    await repo.insertChecks(db, [])
    await repo.insertChecks(db, [
      { monitorId: m.id, checkedAt: T0, ok: false, statusCode: 503, region: 'primary', confirmed: true },
      { monitorId: m.id, checkedAt: T0, ok: false, statusCode: 503, region: 'probe' }
    ])
    expect(await db.select().from(schema.checks)).toHaveLength(2)
  })

  it('incident lifecycle: insert, reminder, resolve once', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    await repo.insertIncident(db, { id: 'i1', monitorId: m.id, startedAt: T0, confirmedAt: T0 + 30_000, cause: 'HTTP 503' })
    await repo.setIncidentReminder(db, 'i1', T0 + 60_000)
    await repo.resolveIncident(db, 'i1', T0 + 90_000)
    await repo.resolveIncident(db, 'i1', T0 + 999_999) // must not overwrite
    const row = await db.query.incidents.findFirst({ where: eq(schema.incidents.id, 'i1') })
    expect(row).toMatchObject({ lastReminderAt: T0 + 60_000, resolvedAt: T0 + 90_000 })
  })

  it('resolveOpenIncidents closes only open incidents for that monitor', async () => {
    const db = makeDb()
    const a = await seedMonitor(db)
    const b = await seedMonitor(db)
    await repo.insertIncident(db, { id: 'ia', monitorId: a.id, startedAt: T0, confirmedAt: T0, cause: 'x' })
    await repo.insertIncident(db, { id: 'ib', monitorId: b.id, startedAt: T0, confirmedAt: T0, cause: 'x' })
    await repo.resolveOpenIncidents(db, a.id, T0 + 5)
    const rows = await db.select().from(schema.incidents)
    expect(rows.find((r) => r.id === 'ia')!.resolvedAt).toBe(T0 + 5)
    expect(rows.find((r) => r.id === 'ib')!.resolvedAt).toBeNull()
  })

  it('getContactsForMonitor returns only linked contacts', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    const c1 = await seedContact(db, { name: 'Dev Slack' })
    await seedContact(db, { name: 'Unlinked' })
    await db.insert(schema.monitorContacts).values({ monitorId: m.id, contactId: c1.id })
    expect(await repo.getContactsForMonitor(db, m.id)).toEqual([
      { id: c1.id, name: 'Dev Slack', type: 'slack', target: c1.target }
    ])
  })

  it('insertDelivery and updateMonitorStatus', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    const c = await seedContact(db)
    await repo.insertDelivery(db, {
      id: 'd1',
      monitorId: m.id,
      contactId: c.id,
      kind: 'down',
      attempt: 1,
      ok: true,
      sentAt: T0
    })
    await repo.updateMonitorStatus(db, m.id, {
      status: 'down',
      consecutiveFailures: 2,
      lastCheckedAt: T0,
      lastResponseMs: null,
      lastStatusCode: 503
    })
    const row = await db.query.monitors.findFirst({ where: eq(schema.monitors.id, m.id) })
    expect(row).toMatchObject({ status: 'down', consecutiveFailures: 2, lastCheckedAt: T0, lastStatusCode: 503 })
    expect(await db.select().from(schema.alertDeliveries)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/repo.test.ts`
Expected: FAIL — cannot resolve `../../server/engine/repo`.

- [ ] **Step 3: Implement `server/engine/repo.ts`**

```ts
import { and, eq, gt, isNull, lte, or } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import type { Contact, MonitorConfig, MonitorStatus } from './types'

/** Same shape as server/utils/db.ts `Db`; redeclared so the engine never imports Nitro code. */
export type EngineDb = DrizzleD1Database<typeof schema>
export type NewCheck = typeof schema.checks.$inferInsert
export type NewDelivery = typeof schema.alertDeliveries.$inferInsert

export interface MonitorStatusPatch {
  status: MonitorStatus
  consecutiveFailures: number
  lastCheckedAt: number
  lastResponseMs: number | null
  lastStatusCode: number | null
}

export async function getMonitor(db: EngineDb, id: string): Promise<MonitorConfig | null> {
  const row = await db.query.monitors.findFirst({ where: eq(schema.monitors.id, id) })
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    intervalS: row.intervalS,
    timeoutMs: row.timeoutMs,
    failThreshold: row.failThreshold,
    reminderMins: row.reminderMins,
    paused: row.paused
  }
}

/** A window applies if it targets this monitor or all monitors (monitor_id null). End is exclusive. */
export async function isInMaintenance(db: EngineDb, monitorId: string, now: number): Promise<boolean> {
  const w = schema.maintenanceWindows
  const rows = await db
    .select({ id: w.id })
    .from(w)
    .where(and(or(eq(w.monitorId, monitorId), isNull(w.monitorId)), lte(w.startsAt, now), gt(w.endsAt, now)))
    .limit(1)
  return rows.length > 0
}

export async function insertChecks(db: EngineDb, rows: NewCheck[]): Promise<void> {
  if (rows.length) await db.insert(schema.checks).values(rows)
}

export async function insertIncident(
  db: EngineDb,
  row: { id: string; monitorId: string; startedAt: number; confirmedAt: number; cause: string }
): Promise<void> {
  await db.insert(schema.incidents).values(row)
}

export async function resolveIncident(db: EngineDb, id: string, resolvedAt: number): Promise<void> {
  await db
    .update(schema.incidents)
    .set({ resolvedAt })
    .where(and(eq(schema.incidents.id, id), isNull(schema.incidents.resolvedAt)))
}

export async function resolveOpenIncidents(db: EngineDb, monitorId: string, resolvedAt: number): Promise<void> {
  await db
    .update(schema.incidents)
    .set({ resolvedAt })
    .where(and(eq(schema.incidents.monitorId, monitorId), isNull(schema.incidents.resolvedAt)))
}

export async function setIncidentReminder(db: EngineDb, id: string, at: number): Promise<void> {
  await db.update(schema.incidents).set({ lastReminderAt: at }).where(eq(schema.incidents.id, id))
}

export async function getContactsForMonitor(db: EngineDb, monitorId: string): Promise<Contact[]> {
  return db
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      type: schema.contacts.type,
      target: schema.contacts.target
    })
    .from(schema.contacts)
    .innerJoin(schema.monitorContacts, eq(schema.monitorContacts.contactId, schema.contacts.id))
    .where(eq(schema.monitorContacts.monitorId, monitorId))
}

export async function insertDelivery(db: EngineDb, row: NewDelivery): Promise<void> {
  await db.insert(schema.alertDeliveries).values(row)
}

export async function updateMonitorStatus(db: EngineDb, id: string, patch: MonitorStatusPatch): Promise<void> {
  await db.update(schema.monitors).set(patch).where(eq(schema.monitors.id, id))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): add D1 repository for monitors, incidents and deliveries"
```

---
### Task 8: Durable Objects (MonitorDO, ProbeDO) + dev sidecar + integration tests

**Files:**
- Create: `server/engine/ProbeDO.ts`, `server/engine/probeClient.ts`, `server/engine/MonitorDO.ts`, `.cloudflare/engine-dev.ts`, `wrangler.dev.jsonc`, `tests/integration/apply-migrations.ts`, `tests/integration/env.d.ts`, `tests/integration/monitor-do.test.ts`
- Modify: `.cloudflare/worker.ts` (re-export DOs), `wrangler.jsonc` (DO bindings + migrations per env), `vitest.config.ts` (integration project), `package.json` (scripts)

**Interfaces:**
- Consumes: `runCheck` (Task 4), `evaluate`, `initialState` (Task 5), `createSender`, `SendAlert` (Task 6), `repo.*` (Task 7), `PROBE_NAME`, `PROBE_LOCATION_HINT` (Task 2)
- Produces:
  - `class MonitorDO` — HTTP routes (all `POST`, JSON body `{ monitorId }` where needed): `/reload`, `/stop`, `/check-now`, `/destroy`. Public methods `reload(monitorId)`, `stop()`, `checkNow()`, `destroy()`, `alarm()`, `tick(): Promise<number | null>`; overridable `deps: MonitorDeps`.
  - `interface MonitorDeps { runCheck(url, timeoutMs): Promise<CheckResult>; probe(url, timeoutMs): Promise<CheckResult>; sendAlert: SendAlert; now(): number; newId(): string }`
  - `interface EngineEnv { DB: D1Database; PROBE: DurableObjectNamespace; RESEND_API_KEY: string; MAIL_FROM: string; PUBLIC_BASE_URL: string }`
  - `class ProbeDO` — `POST /probe` body `{ url, timeoutMs }` → `CheckResult` JSON.
  - `probeCheck(ns: DurableObjectNamespace, url: string, timeoutMs: number): Promise<CheckResult>`
  - Dev sidecar on `:8787`: forwards `POST /<op>` with headers `x-do-ns: monitor`, `x-do-id: <monitorId>` to the named MonitorDO.

- [ ] **Step 1: Install the Workers test pool**

```bash
npm i -D @cloudflare/vitest-pool-workers@^0.22.0
```

- [ ] **Step 2: Write `server/engine/ProbeDO.ts` and `server/engine/probeClient.ts`**

`server/engine/ProbeDO.ts`:
```ts
import type { DurableObjectState } from '@cloudflare/workers-types'
import { runCheck } from './runCheck'

/**
 * Second-opinion checker. One instance named `probe-enam`, created with
 * `locationHint: 'enam'` so it runs in eastern North America — a different
 * network path from the UK-placed MonitorDOs. Stateless.
 */
export class ProbeDO {
  constructor(
    private ctx: DurableObjectState,
    private env: unknown
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method !== 'POST' || url.pathname !== '/probe') return new Response('Not found', { status: 404 })
    const body = (await request.json()) as { url: string; timeoutMs: number }
    return Response.json(await runCheck(body.url, { timeoutMs: body.timeoutMs }))
  }
}
```

`server/engine/probeClient.ts`:
```ts
import type { DurableObjectNamespace } from '@cloudflare/workers-types'
import { PROBE_LOCATION_HINT, PROBE_NAME } from '../../shared/utils/constants'
import type { CheckResult } from './types'

/** Throws if the probe itself is unreachable — MonitorDO treats that as a confirmed failure. */
export async function probeCheck(ns: DurableObjectNamespace, url: string, timeoutMs: number): Promise<CheckResult> {
  const stub = ns.get(ns.idFromName(PROBE_NAME), { locationHint: PROBE_LOCATION_HINT })
  const res = await stub.fetch('https://probe/probe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, timeoutMs })
  })
  if (!res.ok) throw new Error(`Probe responded ${res.status}`)
  return (await res.json()) as CheckResult
}
```

- [ ] **Step 3: Write `server/engine/MonitorDO.ts`**

```ts
import type { D1Database, DurableObjectNamespace, DurableObjectState } from '@cloudflare/workers-types'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { evaluate, initialState, type EvaluateResult } from './evaluate'
import { createSender, type SendAlert } from './notify'
import { probeCheck } from './probeClient'
import * as repo from './repo'
import { runCheck } from './runCheck'
import type { Action, CheckResult, MonitorConfig, MonitorState } from './types'

export interface EngineEnv {
  DB: D1Database
  PROBE: DurableObjectNamespace
  RESEND_API_KEY: string
  MAIL_FROM: string
  PUBLIC_BASE_URL: string
}

/** Everything with a side effect outside D1/storage. Replaced wholesale in integration tests. */
export interface MonitorDeps {
  runCheck(url: string, timeoutMs: number): Promise<CheckResult>
  probe(url: string, timeoutMs: number): Promise<CheckResult>
  sendAlert: SendAlert
  now(): number
  newId(): string
}

/** Retry delay when a tick blows up, so one bad tick can never stop a monitor. */
const CRASH_RETRY_MS = 60_000

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    console.error(`[MonitorDO] ${label} failed:`, err instanceof Error ? err.message : err)
    return fallback
  }
}

/**
 * One instance per monitored site, named by monitor id (`idFromName(monitorId)`).
 * Storage: `monitorId` (string), `state` (MonitorState). Config is re-read from D1
 * on every tick, so dashboard edits apply on the next check without a message.
 */
export class MonitorDO {
  deps: MonitorDeps

  constructor(
    private ctx: DurableObjectState,
    private env: EngineEnv
  ) {
    this.deps = {
      runCheck: (url, timeoutMs) => runCheck(url, { timeoutMs }),
      probe: (url, timeoutMs) => probeCheck(env.PROBE, url, timeoutMs),
      sendAlert: createSender({
        fetch: (input, init) => fetch(input, init),
        resendApiKey: env.RESEND_API_KEY,
        mailFrom: env.MAIL_FROM
      }),
      now: () => Date.now(),
      newId: () => crypto.randomUUID()
    }
  }

  private get db() {
    return drizzle(this.env.DB, { schema })
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Not found', { status: 404 })
    const { pathname } = new URL(request.url)
    const body = (await request.json().catch(() => ({}))) as { monitorId?: string }
    switch (pathname) {
      case '/reload':
        if (!body.monitorId) return new Response('monitorId required', { status: 400 })
        await this.reload(body.monitorId)
        break
      case '/stop':
        await this.stop()
        break
      case '/check-now':
        await this.checkNow()
        break
      case '/destroy':
        await this.destroy()
        break
      default:
        return new Response('Not found', { status: 404 })
    }
    return Response.json({ ok: true })
  }

  /** Called after any config change. A new interval applies from now, never later than already scheduled. */
  async reload(monitorId: string): Promise<void> {
    await this.ctx.storage.put('monitorId', monitorId)
    const config = await repo.getMonitor(this.db, monitorId)
    if (!config || config.paused) {
      await this.ctx.storage.deleteAlarm()
      return
    }
    const now = this.deps.now()
    const existing = await this.ctx.storage.getAlarm()
    const next = existing === null ? now : Math.min(existing, now + config.intervalS * 1000)
    await this.ctx.storage.setAlarm(next)
  }

  /** Pause: no more checks; any open incident is closed silently so resuming starts clean. */
  async stop(): Promise<void> {
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.delete('state')
    const monitorId = await this.ctx.storage.get<string>('monitorId')
    if (monitorId) await repo.resolveOpenIncidents(this.db, monitorId, this.deps.now())
  }

  async checkNow(): Promise<void> {
    if (await this.ctx.storage.get<string>('monitorId')) await this.ctx.storage.setAlarm(this.deps.now())
  }

  async destroy(): Promise<void> {
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
  }

  async alarm(): Promise<void> {
    let next: number | null = this.deps.now() + CRASH_RETRY_MS
    try {
      next = await this.tick()
    } catch (err) {
      console.error('[MonitorDO] tick crashed:', err instanceof Error ? err.stack : err)
    } finally {
      if (next !== null) await this.ctx.storage.setAlarm(next)
    }
  }

  /** One check cycle. Returns when to run next, or null to stop (monitor deleted or paused). */
  async tick(): Promise<number | null> {
    const monitorId = await this.ctx.storage.get<string>('monitorId')
    if (!monitorId) return null
    const db = this.db
    const config = await repo.getMonitor(db, monitorId)
    if (!config || config.paused) return null

    const primary = await this.deps.runCheck(config.url, config.timeoutMs)
    let probe: CheckResult | null = null
    if (!primary.ok) {
      try {
        probe = await this.deps.probe(config.url, config.timeoutMs)
      } catch (err) {
        // Fail towards alerting: if the probe is unreachable we cannot call it a blip.
        probe = {
          ok: false,
          statusCode: null,
          responseMs: null,
          error: `Probe unavailable: ${err instanceof Error ? err.message : String(err)}`,
          checkedAt: this.deps.now()
        }
      }
    }

    const now = this.deps.now()
    const inMaintenance = await safe('isInMaintenance', () => repo.isInMaintenance(db, monitorId, now), false)
    const state = (await this.ctx.storage.get<MonitorState>('state')) ?? initialState()
    const result = evaluate({ state, config, primary, probe, inMaintenance, now, newIncidentId: this.deps.newId() })
    await this.ctx.storage.put('state', result.nextState)

    const confirmed = !primary.ok && probe !== null && !probe.ok
    await safe(
      'insertChecks',
      () =>
        repo.insertChecks(db, [
          { monitorId, ...checkRow(primary), region: 'primary', confirmed, maintenance: inMaintenance },
          ...(probe
            ? [{ monitorId, ...checkRow(probe), region: 'probe' as const, confirmed, maintenance: inMaintenance }]
            : [])
        ]),
      undefined
    )

    await this.execute(config, result)

    await safe(
      'updateMonitorStatus',
      () =>
        repo.updateMonitorStatus(db, monitorId, {
          status: result.nextState.status,
          consecutiveFailures: result.nextState.consecutiveFailures,
          lastCheckedAt: primary.checkedAt,
          lastResponseMs: primary.responseMs,
          lastStatusCode: primary.statusCode
        }),
      undefined
    )
    return result.nextCheckAt
  }

  private async execute(config: MonitorConfig, result: EvaluateResult): Promise<void> {
    const db = this.db
    for (const action of result.actions) {
      switch (action.type) {
        case 'openIncident':
          await safe(
            'insertIncident',
            () =>
              repo.insertIncident(db, {
                id: action.incidentId,
                monitorId: config.id,
                startedAt: action.startedAt,
                confirmedAt: action.confirmedAt,
                cause: action.cause
              }),
            undefined
          )
          break
        case 'resolveIncident':
          await safe('resolveIncident', () => repo.resolveIncident(db, action.incidentId, action.resolvedAt), undefined)
          break
        case 'markReminder':
          await safe('setIncidentReminder', () => repo.setIncidentReminder(db, action.incidentId, action.at), undefined)
          break
        case 'alert':
          await this.alert(config, action)
          break
      }
    }
  }

  private async alert(config: MonitorConfig, action: Extract<Action, { type: 'alert' }>): Promise<void> {
    const db = this.db
    const contacts = await safe('getContactsForMonitor', () => repo.getContactsForMonitor(db, config.id), [])
    const event = {
      kind: action.kind,
      monitor: { id: config.id, name: config.name, url: config.url },
      cause: action.cause,
      downForMs: action.downForMs,
      dashboardUrl: `${this.env.PUBLIC_BASE_URL}/monitors/${config.id}`
    }
    await Promise.all(
      contacts.map((contact) =>
        this.deps.sendAlert(contact, event, (attempt) =>
          safe(
            'insertDelivery',
            () =>
              repo.insertDelivery(db, {
                id: this.deps.newId(),
                incidentId: action.incidentId,
                monitorId: config.id,
                contactId: contact.id,
                kind: action.kind,
                attempt: attempt.attempt,
                ok: attempt.ok,
                error: attempt.error,
                sentAt: this.deps.now()
              }),
            undefined
          )
        )
      )
    )
  }
}

function checkRow(c: CheckResult) {
  return {
    checkedAt: c.checkedAt,
    ok: c.ok,
    statusCode: c.statusCode,
    responseMs: c.responseMs,
    error: c.error
  }
}
```

- [ ] **Step 4: Write `.cloudflare/engine-dev.ts` and `wrangler.dev.jsonc`**

`.cloudflare/engine-dev.ts`:
```ts
/**
 * Dev + integration-test worker entry. Hosts the real Durable Objects WITHOUT the
 * Nitro bundle, so it runs with no `nuxt build` (same pattern as qa's .cloudflare/do-dev.ts).
 *
 * Under `nuxt dev` the MONITOR binding doesn't exist; server/utils/engine.ts forwards
 * DO calls here over HTTP: `POST http://localhost:8787/<op>` with headers
 * `x-do-ns: monitor` and `x-do-id: <monitorId>`.
 *
 * Keep imports plain-relative — a Nuxt alias here would force a build.
 */
import type { DurableObjectNamespace } from '@cloudflare/workers-types'

export { MonitorDO } from '../server/engine/MonitorDO'
export { ProbeDO } from '../server/engine/ProbeDO'

interface DevEnv {
  MONITOR: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: DevEnv): Promise<Response> {
    const ns = request.headers.get('x-do-ns')
    const id = request.headers.get('x-do-id')
    if (ns !== 'monitor' || !id) {
      return new Response('engine dev worker: expected x-do-ns: monitor and x-do-id headers', { status: 400 })
    }
    const stub = env.MONITOR.get(env.MONITOR.idFromName(id))
    const { pathname } = new URL(request.url)
    return stub.fetch(`https://monitor${pathname}`, {
      method: request.method,
      headers: { 'content-type': 'application/json' },
      body: request.method === 'POST' ? await request.text() : undefined
    }) as unknown as Response
  }
}
```

`wrangler.dev.jsonc`:
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  // Dev sidecar (`npm run dev:engine`, :8787) AND the integration-test worker.
  // Shares the local D1 with `nuxt dev` because both key the SQLite file by database_name.
  // `wrangler dev` auto-loads .env for RESEND_API_KEY / PUBLIC_BASE_URL / MAIL_FROM.
  "name": "hiyield-uptime-engine-dev",
  "main": ".cloudflare/engine-dev.ts",
  "compatibility_date": "2026-08-25",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [
      { "name": "MONITOR", "class_name": "MonitorDO" },
      { "name": "PROBE", "class_name": "ProbeDO" }
    ]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["MonitorDO", "ProbeDO"] }],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "hiyield-uptime",
      "database_id": "LOCAL_PLACEHOLDER",
      "migrations_dir": "server/db/migrations"
    }
  ]
}
```

- [ ] **Step 5: Wire DOs into the production worker and wrangler envs**

Replace `.cloudflare/worker.ts` export block so the file reads:
```ts
/**
 * Worker entry (wrangler `main`). Nitro's cloudflare-module preset only exports
 * `{ fetch }`; DO classes must be named exports of `main` for wrangler to bind them.
 * Add new DO classes here AND to wrangler.jsonc → env.<name>.{durable_objects, migrations}.
 *
 * `nuxt dev` never sees this file — see wrangler.dev.jsonc for how DOs run locally.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - emitted by `nuxt build`, may be absent before a build
import nitroHandler from '../.output/server/index.mjs'

export { MonitorDO } from '../server/engine/MonitorDO'
export { ProbeDO } from '../server/engine/ProbeDO'

export default {
  fetch: nitroHandler.fetch
}
```

In `wrangler.jsonc`, add to BOTH `env.staging` and `env.production` (next to `vars`):
```jsonc
      "durable_objects": {
        "bindings": [
          { "name": "MONITOR", "class_name": "MonitorDO" },
          { "name": "PROBE", "class_name": "ProbeDO" }
        ]
      },
      "migrations": [{ "tag": "v1", "new_sqlite_classes": ["MonitorDO", "ProbeDO"] }],
```

- [ ] **Step 6: Add the integration project to `vitest.config.ts`**

Replace the file with:
```ts
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
```

`tests/integration/apply-migrations.ts`:
```ts
import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

// Idempotent: applyD1Migrations skips migrations already recorded.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
```

`tests/integration/env.d.ts`:
```ts
/// <reference types="@cloudflare/vitest-pool-workers/types" />
import type { D1Migration } from 'cloudflare:test'

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      MONITOR: DurableObjectNamespace
      PROBE: DurableObjectNamespace
      TEST_MIGRATIONS: D1Migration[]
      RESEND_API_KEY: string
      MAIL_FROM: string
      PUBLIC_BASE_URL: string
    }
  }
}

export {}
```

Add scripts to `package.json`:
```json
"dev": "npm run db:migrate && concurrently -k -n nuxt,engine -c green,magenta \"npm:dev:nuxt\" \"npm:dev:engine\"",
"dev:nuxt": "nuxt dev",
"dev:engine": "wrangler dev -c wrangler.dev.jsonc --port 8787 --inspector-port 9229",
"test:integration": "vitest run --project integration",
"test:all": "vitest run"
```
(`dev` replaces the existing `dev` script.)

- [ ] **Step 7: Write the failing integration tests**

`tests/integration/monitor-do.test.ts`:
```ts
import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../../server/db/schema'
import type { MonitorDO } from '../../server/engine/MonitorDO'
import type { AlertEvent, CheckResult, Contact } from '../../server/engine/types'

const db = drizzle(env.DB, { schema })
// An hour in the FUTURE: alarms set during a test must not actually fire mid-test
// (a past alarm time fires immediately and would race the direct alarm() calls).
const T = Date.now() + 3_600_000
let clock = T

const res = (ok: boolean, statusCode: number | null = ok ? 200 : 503): CheckResult => ({
  ok,
  statusCode,
  responseMs: 42,
  error: ok ? null : `HTTP ${statusCode}`,
  checkedAt: clock
})

interface Harness {
  primary: CheckResult[]
  probe: CheckResult[]
  sent: { contact: Contact; event: AlertEvent }[]
  throwOnCheck?: boolean
}

const harness = (): Harness => ({ primary: [], probe: [], sent: [] })

async function seed(id: string, overrides: Partial<typeof schema.monitors.$inferInsert> = {}) {
  await db.insert(schema.monitors).values({
    id,
    name: `Site ${id}`,
    url: `https://${id}.example/`,
    createdAt: T,
    updatedAt: T,
    ...overrides
  })
  await db.insert(schema.contacts).values({
    id: `c_${id}`,
    name: 'Dev Slack',
    type: 'slack',
    target: 'https://hooks.slack.com/services/x',
    createdAt: T
  })
  await db.insert(schema.monitorContacts).values({ monitorId: id, contactId: `c_${id}` })
}

function withMonitor<R>(id: string, h: Harness, fn: (m: MonitorDO, state: DurableObjectState) => Promise<R>) {
  const stub = env.MONITOR.get(env.MONITOR.idFromName(id))
  return runInDurableObject(stub, async (instance: MonitorDO, state: DurableObjectState) => {
    instance.deps = {
      runCheck: async () => {
        if (h.throwOnCheck) throw new Error('boom')
        return h.primary.shift() ?? res(true)
      },
      probe: async () => h.probe.shift() ?? res(true),
      sendAlert: async (contact, event, onAttempt) => {
        h.sent.push({ contact, event })
        await onAttempt?.({ attempt: 1, ok: true, error: null })
        return { ok: true, attempts: 1, error: null }
      },
      now: () => clock,
      newId: () => crypto.randomUUID()
    }
    return fn(instance, state)
  })
}

const monitorRow = (id: string) => db.query.monitors.findFirst({ where: eq(schema.monitors.id, id) })

describe('MonitorDO', () => {
  it('reload schedules an immediate check; tick records it and reschedules at the interval', async () => {
    clock = T
    await seed('m1')
    const h = harness()
    await withMonitor('m1', h, async (m, state) => {
      await m.reload('m1')
      expect(await state.storage.getAlarm()).toBe(T)
      await m.alarm()
      expect(await state.storage.getAlarm()).toBe(T + 300_000)
    })
    expect(await monitorRow('m1')).toMatchObject({ status: 'up', lastCheckedAt: T, lastStatusCode: 200 })
    const rows = await db.select().from(schema.checks).where(eq(schema.checks.monitorId, 'm1'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ok: true, region: 'primary', confirmed: false })
  })

  it('two confirmed failures open an incident and alert; recovery resolves and alerts', async () => {
    clock = T
    await seed('m2')
    const h = harness()
    h.primary.push(res(false), res(false), res(true))
    h.probe.push(res(false), res(false))
    await withMonitor('m2', h, async (m) => {
      await m.reload('m2')
      await m.alarm() // suspect
      clock += 30_000
      await m.alarm() // down
      clock += 600_000
      await m.alarm() // recovered
    })
    expect(h.sent.map((s) => s.event.kind)).toEqual(['down', 'recovered'])
    expect(h.sent[0]!.contact.id).toBe('c_m2')
    expect(h.sent[0]!.event.dashboardUrl).toBe('https://uptime.test/monitors/m2')
    expect(h.sent[1]!.event.downForMs).toBe(630_000)
    const incidents = await db.select().from(schema.incidents).where(eq(schema.incidents.monitorId, 'm2'))
    expect(incidents).toHaveLength(1)
    expect(incidents[0]).toMatchObject({ startedAt: T, confirmedAt: T + 30_000, resolvedAt: T + 630_000, cause: 'HTTP 503' })
    const deliveries = await db.select().from(schema.alertDeliveries).where(eq(schema.alertDeliveries.monitorId, 'm2'))
    expect(deliveries.map((d) => d.kind).sort()).toEqual(['down', 'recovered'])
    expect(await monitorRow('m2')).toMatchObject({ status: 'up' })
  })

  it('a blip is recorded unconfirmed and changes nothing', async () => {
    clock = T
    await seed('m3')
    const h = harness()
    h.primary.push(res(true), res(false))
    h.probe.push(res(true))
    await withMonitor('m3', h, async (m) => {
      await m.reload('m3')
      await m.alarm()
      clock += 300_000
      await m.alarm()
    })
    expect(h.sent).toEqual([])
    expect(await monitorRow('m3')).toMatchObject({ status: 'up' })
    const failed = await db
      .select()
      .from(schema.checks)
      .where(and(eq(schema.checks.monitorId, 'm3'), eq(schema.checks.ok, false)))
    expect(failed.map((r) => [r.region, r.confirmed])).toEqual([
      ['primary', false],
      ['probe', false]
    ])
  })

  it('reload with a shorter interval pulls the next check earlier', async () => {
    clock = T
    await seed('m4')
    const h = harness()
    await withMonitor('m4', h, async (m, state) => {
      await m.reload('m4')
      await m.alarm()
      expect(await state.storage.getAlarm()).toBe(T + 300_000)
      await db.update(schema.monitors).set({ intervalS: 30 }).where(eq(schema.monitors.id, 'm4'))
      await m.reload('m4')
      expect(await state.storage.getAlarm()).toBe(T + 30_000)
    })
  })

  it('stop() while down resolves incident and clears state', async () => {
    clock = T
    await seed('m5', { failThreshold: 1 })
    const h = harness()
    h.primary.push(res(false))
    h.probe.push(res(false))
    await withMonitor('m5', h, async (m, state) => {
      await m.reload('m5')
      await m.alarm()
      clock += 1000
      await m.stop()
      expect(await state.storage.getAlarm()).toBeNull()
      expect(await state.storage.get('state')).toBeUndefined()
    })
    const [incident] = await db.select().from(schema.incidents).where(eq(schema.incidents.monitorId, 'm5'))
    expect(incident!.resolvedAt).toBe(T + 1000)
  })

  it('URL edited while down recovers on next ok check', async () => {
    clock = T
    await seed('m6', { failThreshold: 1 })
    const h = harness()
    h.primary.push(res(false), res(true))
    h.probe.push(res(false))
    await withMonitor('m6', h, async (m) => {
      await m.reload('m6')
      await m.alarm()
      await db.update(schema.monitors).set({ url: 'https://new-host.example/' }).where(eq(schema.monitors.id, 'm6'))
      clock += 300_000
      await m.alarm()
    })
    expect(h.sent.map((s) => s.event.kind)).toEqual(['down', 'recovered'])
    expect(h.sent[1]!.event.monitor!.url).toBe('https://new-host.example/')
  })

  it('a paused monitor does not tick or reschedule', async () => {
    clock = T
    await seed('m7', { paused: true })
    const h = harness()
    await withMonitor('m7', h, async (m, state) => {
      await m.reload('m7')
      expect(await state.storage.getAlarm()).toBeNull()
      expect(await m.tick()).toBeNull()
    })
  })

  it('alarm() reschedules even when the tick throws', async () => {
    clock = T
    await seed('m8')
    const h = harness()
    h.throwOnCheck = true
    await withMonitor('m8', h, async (m, state) => {
      await m.reload('m8')
      await m.alarm()
      expect(await state.storage.getAlarm()).toBe(T + 60_000)
    })
  })

  it('serves its HTTP routes', async () => {
    clock = T
    // Paused, so /reload schedules nothing — this test uses the REAL deps and must not make network calls.
    await seed('m9', { paused: true })
    const stub = env.MONITOR.get(env.MONITOR.idFromName('m9'))
    const r = await stub.fetch('https://monitor/reload', { method: 'POST', body: JSON.stringify({ monitorId: 'm9' }) })
    expect(r.status).toBe(200)
    expect((await stub.fetch('https://monitor/nope', { method: 'POST' })).status).toBe(404)
  })
})
```

Note on the last test: it goes through the real `fetch()` entry point with the real `deps`, so its monitor is seeded paused — `/reload` then schedules no alarm and nothing touches the network.

- [ ] **Step 8: Run integration tests**

Run: `npm run test:integration`
Expected: PASS (9 tests). If the pool fails to start with a config error, read `node_modules/@cloudflare/vitest-pool-workers/README.md` and the linked docs page for the `cloudflareTest` option names in the installed version and adjust `vitest.config.ts` — the test file does not change.

- [ ] **Step 9: Verify the sidecar and production bundle build**

Run:
```bash
npx wrangler deploy -c wrangler.dev.jsonc --dry-run --outdir /tmp/uptime-engine-dry
npm run build && npx wrangler deploy --env staging --dry-run --outdir /tmp/uptime-staging-dry
```
Expected: both dry-runs print the bindings (MONITOR, PROBE, DB) and exit 0. (Staging's `database_id` placeholder is fine for a dry run.)

- [ ] **Step 10: Run all unit tests too**

Run: `npm test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(engine): add MonitorDO and ProbeDO with dev sidecar and integration tests"
```

---

### Task 9: Authentication (Google, @hiyield.co.uk only) and app chrome

**Files:**
- Create: `server/utils/allowedSignup.ts`, `server/utils/auth.ts`, `server/utils/requireUser.ts`, `server/utils/publicPath.ts`, `server/middleware/auth.ts`, `server/api/auth/[...all].ts`, `app/utils/auth-client.ts`, `app/composables/useSessionUser.ts`, `app/middleware/auth.global.ts`, `app/pages/login.vue`, `app/layouts/default.vue`
- Test: `tests/unit/auth.test.ts`

**Interfaces:**
- Consumes: `isAllowedEmail` (Task 2); `CloudflareEnv`, `SessionUser` (Task 1)
- Produces:
  - `assertAllowedSignup(email: string): void` — throws Better Auth `APIError('FORBIDDEN')`
  - `serverAuth(event: H3Event)` — Better Auth instance
  - `requireUser(event: H3Event): Promise<SessionUser>` — 401 no session, 403 wrong domain
  - `isPublicApiPath(path: string): boolean` — `/api/auth/*` and `/api/cron/*`
  - Server middleware: every other `/api/*` request has `event.context.user` set or fails 401/403.
  - Client: `authClient`, `useSessionUser()` → `{ user: Ref<SessionUser | null>, fetchUser(): Promise<SessionUser | null> }`; global route middleware sends signed-out visitors to `/login?redirect=…`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/auth.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { assertAllowedSignup } from '../../server/utils/allowedSignup'
import { isPublicApiPath } from '../../server/utils/publicPath'

describe('assertAllowedSignup', () => {
  it('allows hiyield.co.uk', () => {
    expect(() => assertAllowedSignup('logan@hiyield.co.uk')).not.toThrow()
  })
  it('rejects anyone else with a clear message', () => {
    expect(() => assertAllowedSignup('someone@gmail.com')).toThrow(/Only @hiyield.co.uk Google accounts/)
  })
})

describe('isPublicApiPath', () => {
  it('lets auth and cron through', () => {
    expect(isPublicApiPath('/api/auth/sign-in/social')).toBe(true)
    expect(isPublicApiPath('/api/auth/callback/google')).toBe(true)
    expect(isPublicApiPath('/api/cron/prune')).toBe(true)
  })
  it('protects everything else', () => {
    expect(isPublicApiPath('/api/monitors')).toBe(false)
    expect(isPublicApiPath('/api/authx')).toBe(false)
    expect(isPublicApiPath('/api/contacts/1/test')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/auth.test.ts`
Expected: FAIL — cannot resolve `../../server/utils/allowedSignup`.

- [ ] **Step 3: Implement the pure helpers**

`server/utils/allowedSignup.ts`:
```ts
import { APIError } from 'better-auth/api'
import { isAllowedEmail } from '../../shared/utils/email'

/** Runs in Better Auth's user.create.before hook — blocks the account before it exists. */
export function assertAllowedSignup(email: string): void {
  if (!isAllowedEmail(email)) {
    throw new APIError('FORBIDDEN', { message: 'Only @hiyield.co.uk Google accounts can sign in.' })
  }
}
```

`server/utils/publicPath.ts`:
```ts
/** API paths that skip the session check. Cron routes check x-admin-secret instead. */
export function isPublicApiPath(path: string): boolean {
  return path.startsWith('/api/auth/') || path.startsWith('/api/cron/')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Write Better Auth server wiring**

`server/utils/auth.ts`:
```ts
import { betterAuth } from 'better-auth'
import { getRequestURL, type H3Event } from 'h3'
import { assertAllowedSignup } from './allowedSignup'

/**
 * Better Auth per request (bindings are request-scoped on Workers — same as qa).
 * Google only. `hd` makes Google's account picker prefer Hiyield accounts; the
 * create hook is what actually enforces the domain.
 */
export function serverAuth(event: H3Event) {
  const env = event.context.cloudflare?.env
  if (!env?.DB) throw new Error('D1 binding DB not found on event.context.cloudflare.env')

  // In dev, trust the origin the request came from (nuxt dev :3000 or cf:dev :8787).
  const devOrigin = import.meta.dev ? getRequestURL(event).origin : null

  return betterAuth({
    database: env.DB,
    baseURL: devOrigin ?? env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: 'select_account',
        hd: 'hiyield.co.uk'
      }
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            assertAllowedSignup(user.email)
            return { data: user }
          }
        }
      }
    }
  })
}
```
If `hd` is reported as an unknown option by TypeScript in the installed Better Auth version, delete that one line — the hook still enforces the domain.

`server/utils/requireUser.ts`:
```ts
import { createError, type H3Event } from 'h3'
import { isAllowedEmail } from '../../shared/utils/email'
import type { SessionUser } from '../types/cloudflare'
import { serverAuth } from './auth'

export async function requireUser(event: H3Event): Promise<SessionUser> {
  const session = await serverAuth(event).api.getSession({ headers: event.headers })
  if (!session?.user) throw createError({ statusCode: 401, statusMessage: 'Unauthenticated' })
  if (!isAllowedEmail(session.user.email)) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  return { id: session.user.id, email: session.user.email, name: session.user.name }
}
```

`server/middleware/auth.ts`:
```ts
import { defineEventHandler, getRequestURL } from 'h3'
import { isPublicApiPath } from '../utils/publicPath'
import { requireUser } from '../utils/requireUser'

/** Every /api route is authenticated unless listed in isPublicApiPath — no per-route opt-in to forget. */
export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/') || isPublicApiPath(path)) return
  event.context.user = await requireUser(event)
})
```

`server/api/auth/[...all].ts`:
```ts
// Forwards /api/auth/* (sign-in, Google callback, get-session, sign-out) to Better Auth.
export default defineEventHandler((event) => serverAuth(event).handler(toWebRequest(event)))
```

- [ ] **Step 6: Write the client side**

`app/utils/auth-client.ts`:
```ts
import { createAuthClient } from 'better-auth/vue'

/** Same-origin: Better Auth defaults to /api/auth/*. */
export const authClient = createAuthClient()
```

`app/composables/useSessionUser.ts`:
```ts
export interface SessionUser {
  id: string
  name: string
  email: string
}

/**
 * Session fetched once per page load (sign-in/out always leave via a full navigation).
 * Uses useRequestFetch so the cookie is forwarded during SSR.
 */
export function useSessionUser() {
  const user = useState<SessionUser | null | undefined>('session-user', () => undefined)

  async function fetchUser(): Promise<SessionUser | null> {
    if (user.value !== undefined) return user.value
    const session = await useRequestFetch()<{ user?: SessionUser } | null>('/api/auth/get-session')
    user.value = session?.user ?? null
    return user.value
  }

  return { user, fetchUser }
}
```

`app/middleware/auth.global.ts`:
```ts
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return
  const { fetchUser } = useSessionUser()
  const user = await fetchUser()
  if (!user) return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
})
```

`app/pages/login.vue`:
```vue
<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ layout: false })

const route = useRoute()
const loading = ref(false)
const error = computed(() =>
  route.query.error ? 'Only @hiyield.co.uk Google accounts can sign in.' : null
)

async function signIn() {
  loading.value = true
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  await authClient.signIn.social({ provider: 'google', callbackURL: redirect, errorCallbackURL: '/login?error=1' })
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-slate-50 px-4">
    <UCard class="w-full max-w-sm">
      <div class="space-y-4 text-center">
        <h1 class="text-xl font-semibold">Hiyield Uptime</h1>
        <p class="text-sm text-slate-500">Sign in with your Hiyield Google account.</p>
        <UAlert v-if="error" color="error" variant="subtle" :title="error" />
        <UButton block size="lg" icon="i-lucide-log-in" :loading="loading" @click="signIn">
          Sign in with Google
        </UButton>
      </div>
    </UCard>
  </div>
</template>
```

`app/layouts/default.vue`:
```vue
<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

const { user } = useSessionUser()
const links = [
  { label: 'Status', to: '/', icon: 'i-lucide-activity' },
  { label: 'Contacts', to: '/contacts', icon: 'i-lucide-bell' },
  { label: 'Maintenance', to: '/maintenance', icon: 'i-lucide-wrench' }
]

async function signOut() {
  await authClient.signOut()
  window.location.href = '/login'
}
</script>

<template>
  <div class="min-h-screen bg-slate-50">
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <NuxtLink to="/" class="font-semibold">Hiyield Uptime</NuxtLink>
        <UNavigationMenu :items="links" class="flex-1" />
        <span v-if="user" class="hidden text-sm text-slate-500 sm:inline">{{ user.email }}</span>
        <UButton variant="ghost" color="neutral" icon="i-lucide-log-out" @click="signOut">Sign out</UButton>
      </div>
    </header>
    <main class="mx-auto max-w-6xl px-4 py-6">
      <slot />
    </main>
  </div>
</template>
```

- [ ] **Step 7: Verify the gate manually**

Create `.env` from `.env.example` (any non-empty values for Google keys are enough for this check). Run `npm run dev`, then in another terminal:
```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/monitors
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/auth/get-session
```
Expected: `401` then `200`. Opening `http://localhost:3000/` in a browser redirects to `/login?redirect=/`.

If real Google credentials are available (Hiyield Google Cloud → OAuth client, type "Web", redirect URI `http://localhost:3000/api/auth/callback/google`), sign in with a `@hiyield.co.uk` account and confirm the placeholder page loads; a personal Gmail account must land on `/login?error=1`. If credentials aren't available yet, note it in the task report — the user sets them up before deploy (Task 17).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(auth): Google sign-in restricted to hiyield.co.uk, API gate and app layout"
```

---

### Task 10: Monitors API, validation and bulk add

**Files:**
- Create: `shared/utils/validation.ts`, `shared/utils/bulk.ts`, `server/utils/engine.ts`, `server/utils/monitors.ts`, `server/api/monitors/index.post.ts`, `server/api/monitors/[id].get.ts`, `server/api/monitors/[id].put.ts`, `server/api/monitors/[id].delete.ts`, `server/api/monitors/[id]/check.post.ts`, `server/api/monitors/[id]/pause.post.ts`, `server/api/monitors/[id]/resume.post.ts`, `server/api/monitors/bulk.post.ts`, `server/api/monitors/test-url.post.ts`
- Test: `tests/unit/monitors.test.ts`

**Interfaces:**
- Consumes: schema, `Db`, `useDb` (Task 3); `runCheck` (Task 4); constants (Task 2)
- Produces:
  - `normaliseUrl(raw: string): string | null`
  - `monitorInputSchema` (zod) → `MonitorInput = { name; url; intervalS; timeoutMs; failThreshold; reminderMins; paused; contactIds: string[] }`
  - `testUrlSchema` → `{ url; timeoutMs }`
  - `parseBulk(text: string): BulkRow[]` with `BulkRow = { line: number; name: string; url: string; error: string | null }`
  - `callMonitor(event, monitorId, op: 'reload' | 'stop' | 'check-now' | 'destroy'): Promise<void>`
  - `createMonitor(db, input: MonitorInput, now: number, id: string): Promise<void>`, `updateMonitor(db, id, input, now): Promise<boolean>`, `defaultContactIds(db): Promise<string[]>`, `getMonitorWithContacts(db, id)`
  - Endpoints: `POST /api/monitors` → `{ id }`; `GET /api/monitors/:id` → `MonitorRow & { contactIds }`; `PUT /api/monitors/:id`; `DELETE /api/monitors/:id`; `POST /api/monitors/:id/check|pause|resume`; `POST /api/monitors/bulk` body `{ text }` → `{ created: number }` or 400 `{ rows }`; `POST /api/monitors/test-url` → `CheckResult`

- [ ] **Step 1: Write the failing tests**

`tests/unit/monitors.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { monitorInputSchema, normaliseUrl } from '../../shared/utils/validation'
import { parseBulk } from '../../shared/utils/bulk'
import { createMonitor, defaultContactIds, getMonitorWithContacts, updateMonitor } from '../../server/utils/monitors'
import { makeDb, seedContact, schema, T0 } from './_db'

const valid = {
  name: 'Acme',
  url: 'https://acme.example',
  intervalS: 300,
  timeoutMs: 10_000,
  failThreshold: 2,
  reminderMins: 30,
  paused: false,
  contactIds: []
}

describe('normaliseUrl', () => {
  it('trims and lowercases the scheme', () => {
    expect(normaliseUrl('  HTTPS://Acme.example/path?q=1  ')).toBe('https://acme.example/path?q=1')
  })
  it('rejects non-http(s) and garbage', () => {
    expect(normaliseUrl('ftp://acme.example')).toBeNull()
    expect(normaliseUrl('acme.example')).toBeNull()
    expect(normaliseUrl('')).toBeNull()
  })
})

describe('monitorInputSchema', () => {
  it('accepts a valid monitor and normalises the URL', () => {
    const r = monitorInputSchema.parse({ ...valid, url: ' https://acme.example ' })
    expect(r.url).toBe('https://acme.example/')
  })
  it('rejects intervals outside the allowed set', () => {
    expect(monitorInputSchema.safeParse({ ...valid, intervalS: 45 }).success).toBe(false)
  })
  it('rejects out-of-range timeout, threshold and reminder', () => {
    expect(monitorInputSchema.safeParse({ ...valid, timeoutMs: 500 }).success).toBe(false)
    expect(monitorInputSchema.safeParse({ ...valid, timeoutMs: 31_000 }).success).toBe(false)
    expect(monitorInputSchema.safeParse({ ...valid, failThreshold: 0 }).success).toBe(false)
    expect(monitorInputSchema.safeParse({ ...valid, failThreshold: 11 }).success).toBe(false)
    expect(monitorInputSchema.safeParse({ ...valid, reminderMins: 5 }).success).toBe(false)
  })
  it('rejects a blank name and a non-http URL', () => {
    expect(monitorInputSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false)
    expect(monitorInputSchema.safeParse({ ...valid, url: 'ftp://x' }).success).toBe(false)
  })
})

describe('parseBulk', () => {
  it('parses name, url lines with CRLF, blanks and comments', () => {
    const rows = parseBulk('# clients\r\nAcme, https://acme.example\r\n\r\nBeta Ltd,https://beta.example/shop\r\n')
    expect(rows).toEqual([
      { line: 2, name: 'Acme', url: 'https://acme.example/', error: null },
      { line: 4, name: 'Beta Ltd', url: 'https://beta.example/shop', error: null }
    ])
  })
  it('keeps commas inside the URL (splits on the first comma only)', () => {
    const [row] = parseBulk('Gamma, https://gamma.example/?a=1,2')
    expect(row).toMatchObject({ name: 'Gamma', url: 'https://gamma.example/?a=1,2', error: null })
  })
  it('flags bad lines without dropping good ones', () => {
    const rows = parseBulk('no comma here\n, https://x.example\nDelta, not-a-url\nEcho, https://e.example\nEcho 2, https://e.example')
    expect(rows.map((r) => r.error)).toEqual([
      'Expected: name, url',
      'Name is required',
      'Enter a full http:// or https:// URL',
      null,
      'Duplicate URL (line 4)'
    ])
  })
})

describe('monitor persistence', () => {
  it('createMonitor stores the monitor and its contacts', async () => {
    const db = makeDb()
    const c = await seedContact(db)
    await createMonitor(db, monitorInputSchema.parse({ ...valid, contactIds: [c.id] }), T0, 'm1')
    const m = await getMonitorWithContacts(db, 'm1')
    expect(m).toMatchObject({ id: 'm1', name: 'Acme', url: 'https://acme.example/', status: 'unknown', contactIds: [c.id] })
  })

  it('a paused monitor starts with status paused', async () => {
    const db = makeDb()
    await createMonitor(db, monitorInputSchema.parse({ ...valid, paused: true }), T0, 'm2')
    expect((await getMonitorWithContacts(db, 'm2'))!.status).toBe('paused')
  })

  it('updateMonitor replaces contacts and returns false for unknown ids', async () => {
    const db = makeDb()
    const a = await seedContact(db)
    const b = await seedContact(db)
    await createMonitor(db, monitorInputSchema.parse({ ...valid, contactIds: [a.id] }), T0, 'm3')
    const ok = await updateMonitor(db, 'm3', monitorInputSchema.parse({ ...valid, name: 'Acme 2', contactIds: [b.id] }), T0 + 1)
    expect(ok).toBe(true)
    const m = await getMonitorWithContacts(db, 'm3')
    expect(m).toMatchObject({ name: 'Acme 2', contactIds: [b.id], updatedAt: T0 + 1 })
    expect(await updateMonitor(db, 'nope', monitorInputSchema.parse(valid), T0)).toBe(false)
  })

  it('defaultContactIds lists contacts flagged default', async () => {
    const db = makeDb()
    const a = await seedContact(db, { isDefault: true })
    await seedContact(db, { isDefault: false })
    expect(await defaultContactIds(db)).toEqual([a.id])
  })

  it('getMonitorWithContacts returns null for unknown ids', async () => {
    const db = makeDb()
    expect(await getMonitorWithContacts(db, 'nope')).toBeNull()
    expect(await db.select().from(schema.monitors).where(eq(schema.monitors.id, 'nope'))).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/monitors.test.ts`
Expected: FAIL — cannot resolve `../../shared/utils/validation`.

- [ ] **Step 3: Implement validation and bulk parsing**

`shared/utils/validation.ts`:
```ts
import { z } from 'zod'
import {
  FAIL_THRESHOLD_MAX,
  FAIL_THRESHOLD_MIN,
  INTERVALS_S,
  REMINDER_MINS,
  TIMEOUT_MS_MAX,
  TIMEOUT_MS_MIN
} from './constants'

export const URL_ERROR = 'Enter a full http:// or https:// URL'

export function normaliseUrl(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}

const urlField = z.string().transform((v, ctx) => {
  const n = normaliseUrl(v)
  if (!n) {
    ctx.addIssue({ code: 'custom', message: URL_ERROR })
    return z.NEVER
  }
  return n
})

export const monitorInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  url: urlField,
  intervalS: z.number().int().refine((v) => INTERVALS_S.includes(v), 'Choose an interval from the list'),
  timeoutMs: z.number().int().min(TIMEOUT_MS_MIN).max(TIMEOUT_MS_MAX),
  failThreshold: z.number().int().min(FAIL_THRESHOLD_MIN).max(FAIL_THRESHOLD_MAX),
  reminderMins: z.number().int().refine((v) => REMINDER_MINS.includes(v), 'Choose a reminder from the list'),
  paused: z.boolean(),
  contactIds: z.array(z.string()).max(50).default([])
})
export type MonitorInput = z.output<typeof monitorInputSchema>

export const testUrlSchema = z.object({
  url: urlField,
  timeoutMs: z.number().int().min(TIMEOUT_MS_MIN).max(TIMEOUT_MS_MAX).default(10_000)
})
```

`shared/utils/bulk.ts`:
```ts
import { normaliseUrl, URL_ERROR } from './validation'

export interface BulkRow {
  line: number
  name: string
  url: string
  error: string | null
}

/**
 * One site per line: `name, url`. Splits on the FIRST comma so URLs may contain commas.
 * Blank lines and lines starting with # are skipped. Line numbers are 1-based.
 */
export function parseBulk(text: string): BulkRow[] {
  const rows: BulkRow[] = []
  const seen = new Map<string, number>()
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const comma = trimmed.indexOf(',')
    if (comma === -1) {
      rows.push({ line, name: trimmed, url: '', error: 'Expected: name, url' })
      return
    }
    const name = trimmed.slice(0, comma).trim()
    const rawUrl = trimmed.slice(comma + 1).trim()
    const url = normaliseUrl(rawUrl)
    let error: string | null = null
    if (!name) error = 'Name is required'
    else if (!url) error = URL_ERROR
    else if (seen.has(url)) error = `Duplicate URL (line ${seen.get(url)})`
    if (url && !seen.has(url)) seen.set(url, line)
    rows.push({ line, name, url: url ?? rawUrl, error })
  })
  return rows
}
```

- [ ] **Step 4: Implement `server/utils/monitors.ts`**

```ts
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { MonitorInput } from '../../shared/utils/validation'
import type { Db } from './db'

export async function defaultContactIds(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(eq(schema.contacts.isDefault, true))
  return rows.map((r) => r.id)
}

async function replaceContacts(db: Db, monitorId: string, contactIds: string[]): Promise<void> {
  await db.delete(schema.monitorContacts).where(eq(schema.monitorContacts.monitorId, monitorId))
  // One row per statement keeps us well under D1's 100-bound-parameter limit.
  for (const contactId of new Set(contactIds)) {
    await db.insert(schema.monitorContacts).values({ monitorId, contactId })
  }
}

export async function createMonitor(db: Db, input: MonitorInput, now: number, id: string): Promise<void> {
  const { contactIds, ...fields } = input
  await db.insert(schema.monitors).values({
    id,
    ...fields,
    status: fields.paused ? 'paused' : 'unknown',
    createdAt: now,
    updatedAt: now
  })
  await replaceContacts(db, id, contactIds)
}

/** Returns false if the monitor doesn't exist. Status is left to the engine/pause routes. */
export async function updateMonitor(db: Db, id: string, input: MonitorInput, now: number): Promise<boolean> {
  const existing = await db.query.monitors.findFirst({ where: eq(schema.monitors.id, id) })
  if (!existing) return false
  const { contactIds, ...fields } = input
  const status = fields.paused ? 'paused' : existing.status === 'paused' ? 'unknown' : existing.status
  await db
    .update(schema.monitors)
    .set({ ...fields, status, updatedAt: now })
    .where(eq(schema.monitors.id, id))
  await replaceContacts(db, id, contactIds)
  return true
}

export async function getMonitorWithContacts(db: Db, id: string) {
  const monitor = await db.query.monitors.findFirst({ where: eq(schema.monitors.id, id) })
  if (!monitor) return null
  const links = await db
    .select({ contactId: schema.monitorContacts.contactId })
    .from(schema.monitorContacts)
    .where(eq(schema.monitorContacts.monitorId, id))
  return { ...monitor, contactIds: links.map((l) => l.contactId) }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/unit/monitors.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement `server/utils/engine.ts`**

```ts
import { createError, type H3Event } from 'h3'

export type EngineOp = 'reload' | 'stop' | 'check-now' | 'destroy'

/** Sidecar started by `npm run dev` (wrangler.dev.jsonc). */
const DEV_ENGINE_URL = 'http://localhost:8787'

/**
 * Tell a site's MonitorDO about a change. Deployed (and cf:dev): via the MONITOR binding.
 * `nuxt dev`: the binding doesn't exist, so forward to the engine sidecar over HTTP.
 */
export async function callMonitor(event: H3Event, monitorId: string, op: EngineOp): Promise<void> {
  const env = event.context.cloudflare?.env
  const body = JSON.stringify({ monitorId })
  let res: Response
  if (env?.MONITOR) {
    const stub = env.MONITOR.get(env.MONITOR.idFromName(monitorId))
    res = (await stub.fetch(`https://monitor/${op}`, { method: 'POST', body })) as unknown as Response
  } else if (import.meta.dev) {
    res = await fetch(`${DEV_ENGINE_URL}/${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-do-ns': 'monitor', 'x-do-id': monitorId },
      body
    })
  } else {
    throw createError({ statusCode: 500, statusMessage: 'MONITOR binding missing' })
  }
  if (!res.ok) {
    throw createError({ statusCode: 502, statusMessage: `Monitor engine ${op} failed (${res.status})` })
  }
}
```

- [ ] **Step 7: Write the endpoints**

All routes below sit behind `server/middleware/auth.ts` (Task 9). They use Nitro auto-imports (`defineEventHandler`, `readValidatedBody`, `getRouterParam`, `createError`) and the auto-imported server utils.

`server/api/monitors/index.post.ts`:
```ts
export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, monitorInputSchema.parse)
  const db = useDb(event)
  const id = crypto.randomUUID()
  await createMonitor(db, input, Date.now(), id)
  if (!input.paused) await callMonitor(event, id, 'reload')
  return { id }
})
```

`server/api/monitors/[id].get.ts`:
```ts
export default defineEventHandler(async (event) => {
  const monitor = await getMonitorWithContacts(useDb(event), getRouterParam(event, 'id')!)
  if (!monitor) throw createError({ statusCode: 404, statusMessage: 'Monitor not found' })
  return monitor
})
```

`server/api/monitors/[id].put.ts`:
```ts
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const input = await readValidatedBody(event, monitorInputSchema.parse)
  const found = await updateMonitor(useDb(event), id, input, Date.now())
  if (!found) throw createError({ statusCode: 404, statusMessage: 'Monitor not found' })
  await callMonitor(event, id, input.paused ? 'stop' : 'reload')
  return { ok: true }
})
```

`server/api/monitors/[id].delete.ts`:
```ts
import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  // Stop the DO first; if that fails we still delete — a DO with no monitor row stops itself on its next tick.
  await callMonitor(event, id, 'destroy').catch((err) => console.error('[monitors.delete] destroy failed', err))
  await useDb(event).delete(schema.monitors).where(eq(schema.monitors.id, id))
  return { ok: true }
})
```

`server/api/monitors/[id]/check.post.ts`:
```ts
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const monitor = await getMonitorWithContacts(useDb(event), id)
  if (!monitor) throw createError({ statusCode: 404, statusMessage: 'Monitor not found' })
  if (monitor.paused) throw createError({ statusCode: 409, statusMessage: 'Monitor is paused' })
  await callMonitor(event, id, 'check-now')
  return { ok: true }
})
```

`server/api/monitors/[id]/pause.post.ts`:
```ts
import { eq } from 'drizzle-orm'
import * as schema from '../../../db/schema'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  await useDb(event)
    .update(schema.monitors)
    .set({ paused: true, status: 'paused', consecutiveFailures: 0, updatedAt: Date.now() })
    .where(eq(schema.monitors.id, id))
  await callMonitor(event, id, 'stop')
  return { ok: true }
})
```

`server/api/monitors/[id]/resume.post.ts`:
```ts
import { eq } from 'drizzle-orm'
import * as schema from '../../../db/schema'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  await useDb(event)
    .update(schema.monitors)
    .set({ paused: false, status: 'unknown', updatedAt: Date.now() })
    .where(eq(schema.monitors.id, id))
  await callMonitor(event, id, 'reload')
  return { ok: true }
})
```

`server/api/monitors/bulk.post.ts`:
```ts
import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { text } = await readValidatedBody(event, z.object({ text: z.string().max(50_000) }).parse)
  const rows = parseBulk(text)
  if (rows.length === 0 || rows.some((r) => r.error)) {
    throw createError({ statusCode: 400, statusMessage: 'Fix the highlighted lines', data: { rows } })
  }
  const db = useDb(event)
  const contactIds = await defaultContactIds(db)
  const now = Date.now()
  for (const row of rows) {
    const id = crypto.randomUUID()
    await createMonitor(
      db,
      monitorInputSchema.parse({ ...MONITOR_DEFAULTS, name: row.name, url: row.url, contactIds }),
      now,
      id
    )
    await callMonitor(event, id, 'reload')
  }
  return { created: rows.length }
})
```

`server/api/monitors/test-url.post.ts`:
```ts
import { runCheck } from '../../engine/runCheck'

export default defineEventHandler(async (event) => {
  const { url, timeoutMs } = await readValidatedBody(event, testUrlSchema.parse)
  return runCheck(url, { timeoutMs })
})
```

`shared/utils/*` exports are auto-imported in both app and server by Nuxt 4, so `monitorInputSchema`, `parseBulk`, `MONITOR_DEFAULTS`, `testUrlSchema` need no import in route files. If `nuxt typecheck` reports them as undefined, add explicit imports from `'../../../shared/utils/…'` — behaviour is identical.

- [ ] **Step 8: Verify**

Run:
```bash
npm test && npm run build && npm run typecheck
```
Expected: tests PASS; build and typecheck exit 0.

Then with `npm run dev` running and a signed-in browser session, in the browser devtools console on `http://localhost:3000`:
```js
await $fetch('/api/monitors', { method: 'POST', body: { name: 'Example', url: 'https://example.com', intervalS: 60, timeoutMs: 10000, failThreshold: 2, reminderMins: 30, paused: false, contactIds: [] } })
```
Expected: `{ id: '…' }`; the engine terminal (magenta) shows the DO handling `/reload`; within a few seconds `npx wrangler d1 execute hiyield-uptime --local --command "select status, last_checked_at from monitors"` shows `up` with a timestamp. If Google sign-in isn't configured yet, skip this manual check and say so in the report.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(api): monitors CRUD, pause/resume, check-now, bulk add and URL test"
```

---
### Task 11: Contacts and maintenance API

**Files:**
- Modify: `shared/utils/validation.ts` (append contact + maintenance schemas)
- Create: `server/utils/contacts.ts`, `server/utils/maintenance.ts`, `server/api/contacts/index.get.ts`, `server/api/contacts/index.post.ts`, `server/api/contacts/[id].put.ts`, `server/api/contacts/[id].delete.ts`, `server/api/contacts/[id]/test.post.ts`, `server/api/maintenance/index.get.ts`, `server/api/maintenance/index.post.ts`, `server/api/maintenance/[id].delete.ts`
- Test: `tests/unit/contacts.test.ts`

**Interfaces:**
- Consumes: schema, `Db` (Task 3); `createSender` (Task 6); `requireUser` context (`event.context.user`, Task 9)
- Produces:
  - `contactCreateSchema` (discriminated on `type`) → `ContactInput = { type: 'slack' | 'email'; name; target; isDefault }`; `contactUpdateSchema` → `{ name; isDefault; target?: string }`; `maintenanceSchema` → `{ monitorId: string | null; startsAt; endsAt; note }`
  - `maskTarget(type, target): string`
  - `listContacts(db): Promise<ContactListItem[]>` with `ContactListItem = { id; name; type; targetMasked; isDefault; monitors: { id: string; name: string }[]; lastDelivery: { ok: boolean; at: number; error: string | null } | null }`
  - `updateContact(db, id, input): Promise<{ ok: true } | { ok: false; status: 400 | 404; message: string }>`
  - `listMaintenance(db, now): Promise<MaintenanceListItem[]>` with `MaintenanceListItem = MaintenanceRow & { monitorName: string | null }`
  - Endpoints: `GET /api/contacts` → `{ contacts }`; `POST /api/contacts` → `{ id }`; `PUT/DELETE /api/contacts/:id`; `POST /api/contacts/:id/test` → `DeliveryResult`; `GET /api/maintenance` → `{ windows }`; `POST /api/maintenance` → `{ id }`; `DELETE /api/maintenance/:id`

- [ ] **Step 1: Write the failing tests**

`tests/unit/contacts.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { contactCreateSchema, maintenanceSchema } from '../../shared/utils/validation'
import { listContacts, maskTarget, updateContact } from '../../server/utils/contacts'
import { listMaintenance } from '../../server/utils/maintenance'
import { makeDb, seedContact, seedMonitor, schema, T0 } from './_db'

describe('contactCreateSchema', () => {
  it('accepts a Slack webhook and an email', () => {
    expect(
      contactCreateSchema.parse({ type: 'slack', name: '#dev', target: ' https://hooks.slack.com/services/T/B/x ' })
    ).toEqual({ type: 'slack', name: '#dev', target: 'https://hooks.slack.com/services/T/B/x', isDefault: false })
    expect(contactCreateSchema.parse({ type: 'email', name: 'Logan', target: 'logan@hiyield.co.uk', isDefault: true }))
      .toMatchObject({ type: 'email', isDefault: true })
  })
  it('rejects a non-Slack URL for slack and a bad email for email', () => {
    expect(contactCreateSchema.safeParse({ type: 'slack', name: 'x', target: 'https://evil.example/hook' }).success).toBe(false)
    expect(contactCreateSchema.safeParse({ type: 'email', name: 'x', target: 'not-an-email' }).success).toBe(false)
    expect(contactCreateSchema.safeParse({ type: 'sms', name: 'x', target: '+447700900000' }).success).toBe(false)
  })
})

describe('maintenanceSchema', () => {
  it('requires end after start', () => {
    const r = maintenanceSchema.safeParse({ monitorId: null, startsAt: T0, endsAt: T0 })
    expect(r.success).toBe(false)
    expect(r.error!.issues[0]!.message).toBe('End must be after start')
  })
  it('accepts a global window with a default note', () => {
    expect(maintenanceSchema.parse({ monitorId: null, startsAt: T0, endsAt: T0 + 1 })).toEqual({
      monitorId: null,
      startsAt: T0,
      endsAt: T0 + 1,
      note: ''
    })
  })
})

describe('maskTarget', () => {
  it('masks Slack webhooks but not emails', () => {
    expect(maskTarget('slack', 'https://hooks.slack.com/services/T/B/abcdef123456')).toBe('…123456')
    expect(maskTarget('email', 'a@hiyield.co.uk')).toBe('a@hiyield.co.uk')
  })
})

describe('listContacts', () => {
  it('lists contacts with masked targets, linked monitors and the latest delivery', async () => {
    const db = makeDb()
    const m = await seedMonitor(db, { name: 'Acme' })
    const c = await seedContact(db, { name: 'Dev Slack', target: 'https://hooks.slack.com/services/T/B/zzzzzz999999' })
    await seedContact(db, { name: 'Idle', type: 'email', target: 'idle@hiyield.co.uk' })
    await db.insert(schema.monitorContacts).values({ monitorId: m.id, contactId: c.id })
    await db.insert(schema.alertDeliveries).values([
      { id: 'd1', contactId: c.id, kind: 'test', attempt: 1, ok: true, sentAt: T0 },
      { id: 'd2', contactId: c.id, kind: 'test', attempt: 1, ok: false, error: 'Slack responded 404: no_service', sentAt: T0 + 5 }
    ])
    const list = await listContacts(db)
    const dev = list.find((x) => x.name === 'Dev Slack')!
    expect(dev).toMatchObject({
      targetMasked: '…999999',
      monitors: [{ id: m.id, name: 'Acme' }],
      lastDelivery: { ok: false, at: T0 + 5, error: 'Slack responded 404: no_service' }
    })
    expect(list.find((x) => x.name === 'Idle')).toMatchObject({ monitors: [], lastDelivery: null })
    expect(JSON.stringify(list)).not.toContain('zzzzzz')
  })
})

describe('updateContact', () => {
  it('keeps the existing target when none is given', async () => {
    const db = makeDb()
    const c = await seedContact(db)
    expect(await updateContact(db, c.id, { name: 'Renamed', isDefault: true, target: '' })).toEqual({ ok: true })
    const row = await db.query.contacts.findFirst({ where: eq(schema.contacts.id, c.id) })
    expect(row).toMatchObject({ name: 'Renamed', isDefault: true, target: c.target })
  })
  it('validates a new target against the contact type', async () => {
    const db = makeDb()
    const c = await seedContact(db)
    const r = await updateContact(db, c.id, { name: 'x', isDefault: false, target: 'someone@hiyield.co.uk' })
    expect(r).toMatchObject({ ok: false, status: 400 })
  })
  it('404s for unknown contacts', async () => {
    const db = makeDb()
    expect(await updateContact(db, 'nope', { name: 'x', isDefault: false })).toMatchObject({ ok: false, status: 404 })
  })
})

describe('listMaintenance', () => {
  it('shows recent and upcoming windows with the monitor name, newest first', async () => {
    const db = makeDb()
    const m = await seedMonitor(db, { name: 'Acme' })
    const DAY = 86_400_000
    const row = (id: string, monitorId: string | null, startsAt: number, endsAt: number) => ({
      id,
      monitorId,
      startsAt,
      endsAt,
      createdBy: 'a@hiyield.co.uk',
      createdAt: T0
    })
    await db.insert(schema.maintenanceWindows).values([
      row('old', m.id, T0 - 60 * DAY, T0 - 59 * DAY),
      row('recent', m.id, T0 - 2 * DAY, T0 - DAY),
      row('next', null, T0 + DAY, T0 + 2 * DAY)
    ])
    const list = await listMaintenance(db, T0)
    expect(list.map((w) => [w.id, w.monitorName])).toEqual([
      ['next', null],
      ['recent', 'Acme']
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/contacts.test.ts`
Expected: FAIL — `contactCreateSchema` is not exported / `../../server/utils/contacts` not found.

- [ ] **Step 3: Append schemas to `shared/utils/validation.ts`**

```ts
const contactName = z.string().trim().min(1, 'Name is required').max(80)
export const SLACK_WEBHOOK_PREFIX = 'https://hooks.slack.com/'
const slackTarget = z
  .string()
  .trim()
  .startsWith(SLACK_WEBHOOK_PREFIX, 'Must be a Slack incoming webhook URL (https://hooks.slack.com/…)')
const emailTarget = z.string().trim().pipe(z.email('Enter a valid email address'))

export const contactCreateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('slack'), name: contactName, target: slackTarget, isDefault: z.boolean().default(false) }),
  z.object({ type: z.literal('email'), name: contactName, target: emailTarget, isDefault: z.boolean().default(false) })
])
export type ContactInput = z.output<typeof contactCreateSchema>

/** Blank/missing target on update = keep the stored one (the UI never receives the full webhook URL). */
export const contactUpdateSchema = z.object({
  name: contactName,
  isDefault: z.boolean(),
  target: z.string().trim().optional()
})
export type ContactUpdate = z.output<typeof contactUpdateSchema>

export const maintenanceSchema = z
  .object({
    monitorId: z.string().min(1).nullable(),
    startsAt: z.number().int().positive(),
    endsAt: z.number().int().positive(),
    note: z.string().trim().max(500).default('')
  })
  .refine((v) => v.endsAt > v.startsAt, { message: 'End must be after start', path: ['endsAt'] })
export type MaintenanceInput = z.output<typeof maintenanceSchema>
```

- [ ] **Step 4: Implement `server/utils/contacts.ts` and `server/utils/maintenance.ts`**

`server/utils/contacts.ts`:
```ts
import { eq, sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { contactCreateSchema, type ContactUpdate } from '../../shared/utils/validation'
import type { Db } from './db'

export interface ContactListItem {
  id: string
  name: string
  type: 'slack' | 'email'
  targetMasked: string
  isDefault: boolean
  monitors: { id: string; name: string }[]
  lastDelivery: { ok: boolean; at: number; error: string | null } | null
}

/** Slack webhook URLs are credentials — only the last 6 characters ever leave the server. */
export function maskTarget(type: 'slack' | 'email', target: string): string {
  return type === 'slack' ? `…${target.slice(-6)}` : target
}

export async function listContacts(db: Db): Promise<ContactListItem[]> {
  const contacts = await db.select().from(schema.contacts).orderBy(schema.contacts.name)
  const links = await db
    .select({ contactId: schema.monitorContacts.contactId, id: schema.monitors.id, name: schema.monitors.name })
    .from(schema.monitorContacts)
    .innerJoin(schema.monitors, eq(schema.monitors.id, schema.monitorContacts.monitorId))
  // SQLite returns the bare columns from the row holding max(sent_at).
  const latest = await db
    .select({
      contactId: schema.alertDeliveries.contactId,
      ok: schema.alertDeliveries.ok,
      error: schema.alertDeliveries.error,
      at: sql<number>`max(${schema.alertDeliveries.sentAt})`
    })
    .from(schema.alertDeliveries)
    .groupBy(schema.alertDeliveries.contactId)

  return contacts.map((c) => {
    const last = latest.find((l) => l.contactId === c.id)
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      targetMasked: maskTarget(c.type, c.target),
      isDefault: c.isDefault,
      monitors: links.filter((l) => l.contactId === c.id).map((l) => ({ id: l.id, name: l.name })),
      lastDelivery: last ? { ok: Boolean(last.ok), at: Number(last.at), error: last.error } : null
    }
  })
}

export async function updateContact(
  db: Db,
  id: string,
  input: ContactUpdate
): Promise<{ ok: true } | { ok: false; status: 400 | 404; message: string }> {
  const existing = await db.query.contacts.findFirst({ where: eq(schema.contacts.id, id) })
  if (!existing) return { ok: false, status: 404, message: 'Contact not found' }
  let target = existing.target
  if (input.target) {
    const parsed = contactCreateSchema.safeParse({ type: existing.type, name: input.name, target: input.target })
    if (!parsed.success) return { ok: false, status: 400, message: parsed.error.issues[0]!.message }
    target = parsed.data.target
  }
  await db
    .update(schema.contacts)
    .set({ name: input.name, isDefault: input.isDefault, target })
    .where(eq(schema.contacts.id, id))
  return { ok: true }
}
```

`server/utils/maintenance.ts`:
```ts
import { desc, eq, gt } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { MaintenanceRow } from '../db/schema'
import type { Db } from './db'

export type MaintenanceListItem = MaintenanceRow & { monitorName: string | null }

const RECENT_MS = 30 * 86_400_000

/** Upcoming, active, and anything that ended in the last 30 days. */
export async function listMaintenance(db: Db, now: number): Promise<MaintenanceListItem[]> {
  const w = schema.maintenanceWindows
  const rows = await db
    .select({ window: w, monitorName: schema.monitors.name })
    .from(w)
    .leftJoin(schema.monitors, eq(schema.monitors.id, w.monitorId))
    .where(gt(w.endsAt, now - RECENT_MS))
    .orderBy(desc(w.startsAt))
  return rows.map((r) => ({ ...r.window, monitorName: r.monitorName }))
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/unit/contacts.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the endpoints**

`server/api/contacts/index.get.ts`:
```ts
export default defineEventHandler(async (event) => ({ contacts: await listContacts(useDb(event)) }))
```

`server/api/contacts/index.post.ts`:
```ts
import * as schema from '../../db/schema'

export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, contactCreateSchema.parse)
  const id = crypto.randomUUID()
  await useDb(event).insert(schema.contacts).values({ id, ...input, createdAt: Date.now() })
  return { id }
})
```

`server/api/contacts/[id].put.ts`:
```ts
export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, contactUpdateSchema.parse)
  const result = await updateContact(useDb(event), getRouterParam(event, 'id')!, input)
  if (!result.ok) throw createError({ statusCode: result.status, statusMessage: result.message })
  return { ok: true }
})
```

`server/api/contacts/[id].delete.ts`:
```ts
import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'

export default defineEventHandler(async (event) => {
  await useDb(event)
    .delete(schema.contacts)
    .where(eq(schema.contacts.id, getRouterParam(event, 'id')!))
  return { ok: true }
})
```

`server/api/contacts/[id]/test.post.ts`:
```ts
import { eq } from 'drizzle-orm'
import * as schema from '../../../db/schema'
import { createSender } from '../../../engine/notify'

export default defineEventHandler(async (event) => {
  const env = event.context.cloudflare.env
  const db = useDb(event)
  const contact = await db.query.contacts.findFirst({ where: eq(schema.contacts.id, getRouterParam(event, 'id')!) })
  if (!contact) throw createError({ statusCode: 404, statusMessage: 'Contact not found' })
  const send = createSender({
    fetch: (input, init) => fetch(input, init),
    resendApiKey: env.RESEND_API_KEY,
    mailFrom: env.MAIL_FROM
  })
  return send(
    contact,
    { kind: 'test', monitor: null, cause: null, downForMs: null, dashboardUrl: env.PUBLIC_BASE_URL },
    async (a) => {
      await db.insert(schema.alertDeliveries).values({
        id: crypto.randomUUID(),
        contactId: contact.id,
        kind: 'test',
        attempt: a.attempt,
        ok: a.ok,
        error: a.error,
        sentAt: Date.now()
      })
    }
  )
})
```

`server/api/maintenance/index.get.ts`:
```ts
export default defineEventHandler(async (event) => ({ windows: await listMaintenance(useDb(event), Date.now()) }))
```

`server/api/maintenance/index.post.ts`:
```ts
import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'

export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, maintenanceSchema.parse)
  const db = useDb(event)
  if (input.monitorId) {
    const monitor = await db.query.monitors.findFirst({ where: eq(schema.monitors.id, input.monitorId) })
    if (!monitor) throw createError({ statusCode: 400, statusMessage: 'Monitor not found' })
  }
  const id = crypto.randomUUID()
  await db.insert(schema.maintenanceWindows).values({
    id,
    ...input,
    createdBy: event.context.user!.email,
    createdAt: Date.now()
  })
  return { id }
})
```

`server/api/maintenance/[id].delete.ts`:
```ts
import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'

export default defineEventHandler(async (event) => {
  await useDb(event)
    .delete(schema.maintenanceWindows)
    .where(eq(schema.maintenanceWindows.id, getRouterParam(event, 'id')!))
  return { ok: true }
})
```

- [ ] **Step 7: Verify**

Run: `npm test && npm run typecheck`
Expected: PASS / exit 0.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): contacts with masked webhooks and test alerts, maintenance windows"
```

---

### Task 12: Stats, status board API, site history, `/health` and crons

**Files:**
- Create: `server/utils/stats.ts`, `server/utils/requireAdminSecret.ts`, `server/api/monitors/index.get.ts`, `server/api/monitors/[id]/history.get.ts`, `server/routes/health.get.ts`, `server/api/cron/prune.post.ts`, `server/api/cron/reconcile.post.ts`
- Modify: `.cloudflare/worker.ts` (add `scheduled`), `wrangler.jsonc` (crons per env)
- Test: `tests/unit/stats.test.ts`

**Interfaces:**
- Consumes: schema, `Db` (Task 3); `STATUS_SORT` (Task 2); `getMonitorWithContacts` (Task 10); `callMonitor` (Task 10); `CHECK_RETENTION_DAYS` (Task 2)
- Produces:
  - `DAY = 86_400_000`; `uptimePercent(total, failures): number | null` (2 dp)
  - `uptimeFor(db, monitorId, since): Promise<number | null>`; `uptimeByMonitor(db, since): Promise<Map<string, number | null>>`
  - `responseSeries(db, monitorId, since, bucketMs): Promise<{ t: number; avgMs: number }[]>`
  - `interface BoardRow { id; name; url; status: MonitorStatus; paused: boolean; intervalS: number; lastCheckedAt: number | null; lastResponseMs: number | null; lastStatusCode: number | null; uptime24h: number | null; downSince: number | null; inMaintenance: boolean }`; `listBoard(db, now): Promise<BoardRow[]>`
  - `findStaleMonitors(rows, now): string[]`; `pruneChecks(db, before): Promise<void>`
  - `getHistory(db, monitorId, now): Promise<MonitorHistory>` (shape in code)
  - Endpoints: `GET /api/monitors` → `{ monitors: BoardRow[] }`; `GET /api/monitors/:id/history` → `{ monitor, ...MonitorHistory }`; `GET /health` → 200 `{ ok: true }` or 500 `{ ok: false, stale }`; `POST /api/cron/prune`, `POST /api/cron/reconcile` (header `x-admin-secret`)

**Uptime definition:** over `region = 'primary'` and `maintenance = 0` checks; a check counts as a failure only if `ok = 0 AND confirmed = 1` (blips don't hurt uptime).

- [ ] **Step 1: Write the failing tests**

`tests/unit/stats.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  DAY,
  findStaleMonitors,
  getHistory,
  listBoard,
  pruneChecks,
  responseSeries,
  uptimeByMonitor,
  uptimeFor,
  uptimePercent
} from '../../server/utils/stats'
import { makeDb, seedContact, seedMonitor, schema, T0 } from './_db'
import type { Db } from '../../server/utils/db'

const check = (db: Db, monitorId: string, o: Partial<typeof schema.checks.$inferInsert> = {}) =>
  db.insert(schema.checks).values({ monitorId, checkedAt: T0, ok: true, region: 'primary', responseMs: 100, ...o })

describe('uptimePercent', () => {
  it('handles empty and rounds to 2dp', () => {
    expect(uptimePercent(0, 0)).toBeNull()
    expect(uptimePercent(3, 1)).toBe(66.67)
    expect(uptimePercent(288, 0)).toBe(100)
  })
})

describe('uptime queries', () => {
  it('counts only confirmed primary failures outside maintenance', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    await check(db, m.id) // up
    await check(db, m.id, { ok: false, confirmed: true }) // real failure
    await check(db, m.id, { ok: false, confirmed: false }) // blip → not a failure
    await check(db, m.id, { ok: false, confirmed: true, region: 'probe' }) // probe row → ignored
    await check(db, m.id, { ok: false, confirmed: true, maintenance: true }) // maintenance → ignored
    await check(db, m.id, { checkedAt: T0 - 2 * DAY, ok: false, confirmed: true }) // too old
    expect(await uptimeFor(db, m.id, T0 - DAY)).toBe(66.67)
    const all = await uptimeByMonitor(db, T0 - DAY)
    expect(all.get(m.id)).toBe(66.67)
  })
})

describe('responseSeries', () => {
  it('averages response time per bucket, oldest first', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    const B = 300_000
    const base = Math.floor(T0 / B) * B
    await check(db, m.id, { checkedAt: base + 1000, responseMs: 100 })
    await check(db, m.id, { checkedAt: base + 2000, responseMs: 200 })
    await check(db, m.id, { checkedAt: base + B + 1000, responseMs: 50 })
    await check(db, m.id, { checkedAt: base + B + 2000, ok: false, responseMs: null }) // no timing → skipped
    expect(await responseSeries(db, m.id, base - 1, B)).toEqual([
      { t: base, avgMs: 150 },
      { t: base + B, avgMs: 50 }
    ])
  })
})

describe('listBoard', () => {
  it('sorts down first, includes downSince, uptime and maintenance flags', async () => {
    const db = makeDb()
    const up = await seedMonitor(db, { name: 'A up', status: 'up' })
    const down = await seedMonitor(db, { name: 'Z down', status: 'down' })
    const paused = await seedMonitor(db, { name: 'B paused', status: 'paused', paused: true })
    await db
      .insert(schema.incidents)
      .values({ id: 'i1', monitorId: down.id, startedAt: T0 - 600_000, confirmedAt: T0 - 570_000, cause: 'HTTP 503' })
    await check(db, up.id)
    await db.insert(schema.maintenanceWindows).values({
      id: 'w1',
      monitorId: null,
      startsAt: T0 - 1,
      endsAt: T0 + 1,
      createdBy: 'a@hiyield.co.uk',
      createdAt: T0
    })
    const rows = await listBoard(db, T0)
    expect(rows.map((r) => r.name)).toEqual(['Z down', 'A up', 'B paused'])
    expect(rows[0]).toMatchObject({ downSince: T0 - 600_000, inMaintenance: true })
    expect(rows[1]).toMatchObject({ uptime24h: 100, downSince: null })
    expect(rows[2]!.id).toBe(paused.id)
  })
})

describe('findStaleMonitors', () => {
  const base = { paused: false, createdAt: T0 - DAY }
  it('flags monitors overdue by more than 2× interval (min 2 minutes)', () => {
    expect(
      findStaleMonitors(
        [
          { ...base, id: 'fresh', intervalS: 300, lastCheckedAt: T0 - 500_000 },
          { ...base, id: 'stale', intervalS: 300, lastCheckedAt: T0 - 601_000 },
          { ...base, id: 'fast-ok', intervalS: 30, lastCheckedAt: T0 - 110_000 },
          { ...base, id: 'fast-stale', intervalS: 30, lastCheckedAt: T0 - 121_000 },
          { ...base, id: 'paused', paused: true, intervalS: 30, lastCheckedAt: T0 - DAY },
          { ...base, id: 'never', intervalS: 300, lastCheckedAt: null }
        ],
        T0
      )
    ).toEqual(['stale', 'fast-stale', 'never'])
  })
  it('uses createdAt for monitors that have not run yet', () => {
    expect(findStaleMonitors([{ id: 'new', intervalS: 300, paused: false, lastCheckedAt: null, createdAt: T0 - 1000 }], T0)).toEqual([])
  })
})

describe('pruneChecks', () => {
  it('deletes checks older than the cutoff', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    await check(db, m.id, { checkedAt: T0 - 91 * DAY })
    await check(db, m.id, { checkedAt: T0 })
    await pruneChecks(db, T0 - 90 * DAY)
    expect(await db.select().from(schema.checks)).toHaveLength(1)
  })
})

describe('getHistory', () => {
  it('returns uptime, series and recent records for one monitor', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    const c = await seedContact(db, { name: 'Dev Slack' })
    await check(db, m.id)
    await db.insert(schema.incidents).values({ id: 'i1', monitorId: m.id, startedAt: T0, confirmedAt: T0, cause: 'x' })
    await db.insert(schema.alertDeliveries).values({
      id: 'd1',
      incidentId: 'i1',
      monitorId: m.id,
      contactId: c.id,
      kind: 'down',
      attempt: 1,
      ok: true,
      sentAt: T0
    })
    const h = await getHistory(db, m.id, T0 + 1)
    expect(h.uptime).toEqual({ h24: 100, d7: 100, d30: 100 })
    expect(h.series.h24).toHaveLength(1)
    expect(h.incidents.map((i) => i.id)).toEqual(['i1'])
    expect(h.checks).toHaveLength(1)
    expect(h.deliveries[0]).toMatchObject({ contactName: 'Dev Slack', kind: 'down', ok: true })
    expect(h.maintenance).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/stats.test.ts`
Expected: FAIL — cannot resolve `../../server/utils/stats`.

- [ ] **Step 3: Implement `server/utils/stats.ts`**

```ts
import { and, desc, eq, gt, gte, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { STATUS_SORT, type MonitorStatus } from '../../shared/utils/status'
import type { Db } from './db'

export const DAY = 86_400_000
const c = schema.checks

export function uptimePercent(total: number, failures: number): number | null {
  if (total === 0) return null
  return Math.round(((total - failures) / total) * 10_000) / 100
}

const counted = (since: number) => and(gte(c.checkedAt, since), eq(c.region, 'primary'), eq(c.maintenance, false))
const totalSql = sql<number>`count(*)`
const failuresSql = sql<number>`coalesce(sum(case when ${c.ok} = 0 and ${c.confirmed} = 1 then 1 else 0 end), 0)`

export async function uptimeFor(db: Db, monitorId: string, since: number): Promise<number | null> {
  const [row] = await db
    .select({ total: totalSql, failures: failuresSql })
    .from(c)
    .where(and(eq(c.monitorId, monitorId), counted(since)))
  return uptimePercent(Number(row?.total ?? 0), Number(row?.failures ?? 0))
}

export async function uptimeByMonitor(db: Db, since: number): Promise<Map<string, number | null>> {
  const rows = await db
    .select({ monitorId: c.monitorId, total: totalSql, failures: failuresSql })
    .from(c)
    .where(counted(since))
    .groupBy(c.monitorId)
  return new Map(rows.map((r) => [r.monitorId, uptimePercent(Number(r.total), Number(r.failures))]))
}

export async function responseSeries(db: Db, monitorId: string, since: number, bucketMs: number) {
  const b = sql.raw(String(Math.trunc(bucketMs))) // server-chosen constant, never user input
  const bucket = sql<number>`cast(${c.checkedAt} / ${b} as integer) * ${b}`
  const rows = await db
    .select({ t: bucket, avgMs: sql<number>`avg(${c.responseMs})` })
    .from(c)
    .where(and(eq(c.monitorId, monitorId), gte(c.checkedAt, since), eq(c.region, 'primary'), isNotNull(c.responseMs)))
    .groupBy(bucket)
    .orderBy(bucket)
  return rows.map((r) => ({ t: Number(r.t), avgMs: Math.round(Number(r.avgMs)) }))
}

export interface BoardRow {
  id: string
  name: string
  url: string
  status: MonitorStatus
  paused: boolean
  intervalS: number
  lastCheckedAt: number | null
  lastResponseMs: number | null
  lastStatusCode: number | null
  uptime24h: number | null
  downSince: number | null
  inMaintenance: boolean
}

async function activeMaintenance(db: Db, now: number): Promise<{ global: boolean; monitors: Set<string> }> {
  const w = schema.maintenanceWindows
  const rows = await db
    .select({ monitorId: w.monitorId })
    .from(w)
    .where(and(lte(w.startsAt, now), gt(w.endsAt, now)))
  return {
    global: rows.some((r) => r.monitorId === null),
    monitors: new Set(rows.flatMap((r) => (r.monitorId ? [r.monitorId] : [])))
  }
}

export async function listBoard(db: Db, now: number): Promise<BoardRow[]> {
  const monitors = await db.select().from(schema.monitors)
  const uptime = await uptimeByMonitor(db, now - DAY)
  const open = await db
    .select({ monitorId: schema.incidents.monitorId, startedAt: sql<number>`min(${schema.incidents.startedAt})` })
    .from(schema.incidents)
    .where(isNull(schema.incidents.resolvedAt))
    .groupBy(schema.incidents.monitorId)
  const downSince = new Map(open.map((o) => [o.monitorId, Number(o.startedAt)]))
  const maint = await activeMaintenance(db, now)

  return monitors
    .map((m) => ({
      id: m.id,
      name: m.name,
      url: m.url,
      status: m.status,
      paused: m.paused,
      intervalS: m.intervalS,
      lastCheckedAt: m.lastCheckedAt,
      lastResponseMs: m.lastResponseMs,
      lastStatusCode: m.lastStatusCode,
      uptime24h: uptime.get(m.id) ?? null,
      downSince: downSince.get(m.id) ?? null,
      inMaintenance: maint.global || maint.monitors.has(m.id)
    }))
    .sort((a, b) => STATUS_SORT[a.status] - STATUS_SORT[b.status] || a.name.localeCompare(b.name))
}

export function findStaleMonitors(
  rows: { id: string; intervalS: number; paused: boolean; lastCheckedAt: number | null; createdAt: number }[],
  now: number
): string[] {
  return rows
    .filter((r) => !r.paused)
    .filter((r) => now - (r.lastCheckedAt ?? r.createdAt) > Math.max(2 * r.intervalS * 1000, 120_000))
    .map((r) => r.id)
}

export async function pruneChecks(db: Db, before: number): Promise<void> {
  await db.delete(c).where(lt(c.checkedAt, before))
}

export async function getHistory(db: Db, monitorId: string, now: number) {
  const w = schema.maintenanceWindows
  const d = schema.alertDeliveries
  const [h24, d7, d30, series24, series7, incidents, checks, deliveries, maintenance] = await Promise.all([
    uptimeFor(db, monitorId, now - DAY),
    uptimeFor(db, monitorId, now - 7 * DAY),
    uptimeFor(db, monitorId, now - 30 * DAY),
    responseSeries(db, monitorId, now - DAY, 5 * 60_000),
    responseSeries(db, monitorId, now - 7 * DAY, 60 * 60_000),
    db
      .select()
      .from(schema.incidents)
      .where(eq(schema.incidents.monitorId, monitorId))
      .orderBy(desc(schema.incidents.startedAt))
      .limit(50),
    db.select().from(c).where(eq(c.monitorId, monitorId)).orderBy(desc(c.checkedAt), desc(c.id)).limit(50),
    db
      .select({
        id: d.id,
        kind: d.kind,
        attempt: d.attempt,
        ok: d.ok,
        error: d.error,
        sentAt: d.sentAt,
        contactName: schema.contacts.name
      })
      .from(d)
      .innerJoin(schema.contacts, eq(schema.contacts.id, d.contactId))
      .where(eq(d.monitorId, monitorId))
      .orderBy(desc(d.sentAt))
      .limit(50),
    db
      .select()
      .from(w)
      .where(and(or(eq(w.monitorId, monitorId), isNull(w.monitorId)), gt(w.endsAt, now - 7 * DAY)))
      .orderBy(desc(w.startsAt))
  ])
  return {
    uptime: { h24, d7, d30 },
    series: { h24: series24, d7: series7 },
    incidents,
    checks,
    deliveries,
    maintenance
  }
}

export type MonitorHistory = Awaited<ReturnType<typeof getHistory>>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the endpoints, health route and cron routes**

`server/utils/requireAdminSecret.ts`:
```ts
import { createError, getHeader, type H3Event } from 'h3'

/** Cron → Nitro calls carry ADMIN_API_SECRET. An unset secret never matches. */
export function requireAdminSecret(event: H3Event): void {
  const expected = event.context.cloudflare?.env?.ADMIN_API_SECRET
  if (!expected || getHeader(event, 'x-admin-secret') !== expected) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
}
```

`server/api/monitors/index.get.ts`:
```ts
export default defineEventHandler(async (event) => ({ monitors: await listBoard(useDb(event), Date.now()) }))
```

`server/api/monitors/[id]/history.get.ts`:
```ts
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const db = useDb(event)
  const monitor = await getMonitorWithContacts(db, id)
  if (!monitor) throw createError({ statusCode: 404, statusMessage: 'Monitor not found' })
  return { monitor, ...(await getHistory(db, id, Date.now())) }
})
```

`server/routes/health.get.ts`:
```ts
import * as schema from '../db/schema'

/**
 * Public (outside /api, so the auth middleware skips it). Watched by an external pinger:
 * 500 means at least one active monitor has stopped checking.
 */
export default defineEventHandler(async (event) => {
  const m = schema.monitors
  const rows = await useDb(event)
    .select({ id: m.id, intervalS: m.intervalS, paused: m.paused, lastCheckedAt: m.lastCheckedAt, createdAt: m.createdAt })
    .from(m)
  const stale = findStaleMonitors(rows, Date.now())
  if (stale.length) {
    setResponseStatus(event, 500)
    return { ok: false, stale }
  }
  return { ok: true, active: rows.filter((r) => !r.paused).length }
})
```

`server/api/cron/prune.post.ts`:
```ts
export default defineEventHandler(async (event) => {
  requireAdminSecret(event)
  await pruneChecks(useDb(event), Date.now() - CHECK_RETENTION_DAYS * DAY)
  return { ok: true }
})
```

`server/api/cron/reconcile.post.ts`:
```ts
import * as schema from '../../db/schema'

/**
 * Safety net every 10 minutes: any active monitor that has gone quiet gets its DO
 * reloaded (reload schedules an immediate check when no alarm exists).
 */
export default defineEventHandler(async (event) => {
  requireAdminSecret(event)
  const m = schema.monitors
  const rows = await useDb(event)
    .select({ id: m.id, intervalS: m.intervalS, paused: m.paused, lastCheckedAt: m.lastCheckedAt, createdAt: m.createdAt })
    .from(m)
  const stale = findStaleMonitors(rows, Date.now())
  for (const id of stale) {
    await callMonitor(event, id, 'reload').catch((err) => console.error(`[reconcile] ${id}`, err))
  }
  return { reloaded: stale }
})
```

(The 10-minute reconcile cron is an addition to the spec: it repairs a monitor whose alarm was lost, before `/health` needs to page anyone.)

- [ ] **Step 6: Route crons in `.cloudflare/worker.ts` and declare them in `wrangler.jsonc`**

Replace the `export default` in `.cloudflare/worker.ts` with:
```ts
import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types'

const CRON_ROUTES: Record<string, string> = {
  '*/10 * * * *': '/api/cron/reconcile',
  '0 3 * * *': '/api/cron/prune'
}

export default {
  fetch: nitroHandler.fetch,

  /** Forward each cron into Nitro so the logic lives with the app. Never await inside scheduled(). */
  async scheduled(event: ScheduledController, env: { ADMIN_API_SECRET: string }, ctx: ExecutionContext) {
    const path = CRON_ROUTES[event.cron]
    if (!path) return
    const req = new Request(`https://internal${path}`, {
      method: 'POST',
      headers: { 'x-admin-secret': env.ADMIN_API_SECRET }
    })
    ctx.waitUntil(
      nitroHandler.fetch(req, env, ctx).then(async (res: Response) => {
        if (!res.ok) console.error(`[cron] ${path} returned ${res.status}`, await res.text().catch(() => ''))
      })
    )
  }
}
```
(Put the `import type` line at the top of the file with the other imports.)

Add to BOTH `env.staging` and `env.production` in `wrangler.jsonc`:
```jsonc
      "triggers": { "crons": ["*/10 * * * *", "0 3 * * *"] },
```

- [ ] **Step 7: Verify**

Run:
```bash
npm test && npm run typecheck && npm run build && npx wrangler deploy --env staging --dry-run --outdir /tmp/uptime-staging-dry
```
Expected: all pass; dry-run lists the two cron triggers.

With `npm run dev` running:
```bash
curl -s -w '\n%{http_code}\n' http://localhost:3000/health
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/cron/prune
curl -s -w '\n%{http_code}\n' -X POST -H "x-admin-secret: $(grep ADMIN_API_SECRET .env | cut -d= -f2)" http://localhost:3000/api/cron/prune
```
Expected: `{"ok":true,...}` 200; `401`; `{"ok":true}` 200.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): status board, site history, health endpoint and cron jobs"
```

---
### Task 13: Status board page

**Files:**
- Create: `app/components/StatusPill.vue`, `app/utils/errors.ts`, `app/utils/dates.ts`
- Modify: `app/pages/index.vue` (replace placeholder)

**Interfaces:**
- Consumes: `GET /api/monitors` → `{ monitors: BoardRow[] }` (Task 12); `displayStatus`, `MonitorStatus` (Task 2); `formatDuration`, `formatInterval` (Task 2)
- Produces: `<StatusPill :status :in-maintenance />`; `errorMessage(e: unknown): string`; `formatDateTime(ms: number): string`

UI tasks have no unit tests (the spec's tests cover the server). Each UI task ends with a manual browser check against `npm run dev` — use the `run` skill or Chrome tools if available. Every page needs a signed-in session, so if Google sign-in isn't configured locally yet, run `npm run typecheck && npm run build`, report the page as "built, not visually verified", and continue.

- [ ] **Step 1: Write the shared UI helpers**

`app/utils/errors.ts`:
```ts
/** Best human-readable message from a $fetch / H3 error. */
export function errorMessage(e: unknown): string {
  const err = e as { data?: { statusMessage?: string; message?: string }; statusMessage?: string; message?: string }
  return err?.data?.statusMessage ?? err?.data?.message ?? err?.statusMessage ?? err?.message ?? 'Something went wrong'
}
```

`app/utils/dates.ts`:
```ts
export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

/** `<input type="datetime-local">` value ↔ epoch ms, in the browser's local time. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(value: string): number {
  return new Date(value).getTime()
}
```

- [ ] **Step 2: Write `app/components/StatusPill.vue`**

```vue
<script setup lang="ts">
import { displayStatus, type MonitorStatus } from '~~/shared/utils/status'

const props = defineProps<{ status: MonitorStatus; inMaintenance?: boolean }>()
const display = computed(() => displayStatus(props.status, props.inMaintenance ?? false))
</script>

<template>
  <UBadge :color="display.color" variant="subtle" class="font-medium">{{ display.label }}</UBadge>
</template>
```

- [ ] **Step 3: Replace `app/pages/index.vue`**

```vue
<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { BoardRow } from '~~/server/utils/stats'
import { formatDuration, formatInterval } from '~~/shared/utils/format'

const { data, refresh } = await useFetch<{ monitors: BoardRow[] }>('/api/monitors')
useIntervalFn(() => refresh(), 15_000)
const now = useNow({ interval: 1000 })

type Filter = 'all' | 'down' | 'up' | 'paused'
const search = ref('')
const filter = ref<Filter>('all')
const filterItems: { label: string; value: Filter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Down / suspect', value: 'down' },
  { label: 'Up', value: 'up' },
  { label: 'Paused', value: 'paused' }
]

const monitors = computed(() => data.value?.monitors ?? [])
const isDown = (m: BoardRow) => m.status === 'down' || m.status === 'suspect'
const isUp = (m: BoardRow) => m.status === 'up' || m.status === 'unknown'
const counts = computed(() => ({
  down: monitors.value.filter(isDown).length,
  up: monitors.value.filter(isUp).length,
  paused: monitors.value.filter((m) => m.status === 'paused').length
}))

const rows = computed(() =>
  monitors.value.filter((m) => {
    const q = search.value.trim().toLowerCase()
    if (q && !m.name.toLowerCase().includes(q) && !m.url.toLowerCase().includes(q)) return false
    if (filter.value === 'down') return isDown(m)
    if (filter.value === 'up') return isUp(m)
    if (filter.value === 'paused') return m.status === 'paused'
    return true
  })
)

const ago = (t: number | null) => (t ? `${formatDuration(now.value.getTime() - t)} ago` : '—')

const columns: TableColumn<BoardRow>[] = [
  { id: 'status', header: 'Status' },
  { accessorKey: 'name', header: 'Site' },
  { id: 'lastCheck', header: 'Last check' },
  { id: 'response', header: 'Response' },
  { id: 'uptime', header: '24h uptime' },
  { id: 'downFor', header: 'Down for' }
]
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">Status</h1>
        <p class="text-sm text-slate-500">
          <span :class="counts.down ? 'font-medium text-red-600' : ''">{{ counts.down }} down</span>
          · {{ counts.up }} up · {{ counts.paused }} paused
        </p>
      </div>
      <div class="flex gap-2">
        <UButton to="/monitors/bulk" variant="outline" icon="i-lucide-list-plus">Bulk add</UButton>
        <UButton to="/monitors/new" icon="i-lucide-plus">Add monitor</UButton>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <UInput v-model="search" icon="i-lucide-search" placeholder="Search name or URL" class="w-64" />
      <USelect v-model="filter" :items="filterItems" class="w-44" />
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <UTable :data="rows" :columns="columns">
        <template #status-cell="{ row }">
          <StatusPill :status="row.original.status" :in-maintenance="row.original.inMaintenance" />
        </template>
        <template #name-cell="{ row }">
          <NuxtLink :to="`/monitors/${row.original.id}`" class="font-medium hover:underline">
            {{ row.original.name }}
          </NuxtLink>
          <div class="font-mono text-xs text-slate-500">{{ row.original.url }}</div>
        </template>
        <template #lastCheck-cell="{ row }">
          <div>{{ ago(row.original.lastCheckedAt) }}</div>
          <div class="text-xs text-slate-400">every {{ formatInterval(row.original.intervalS) }}</div>
        </template>
        <template #response-cell="{ row }">
          <span class="font-mono">
            {{ row.original.lastResponseMs != null ? `${row.original.lastResponseMs} ms` : '—' }}
          </span>
        </template>
        <template #uptime-cell="{ row }">
          <span class="font-mono">{{ row.original.uptime24h != null ? `${row.original.uptime24h}%` : '—' }}</span>
        </template>
        <template #downFor-cell="{ row }">
          <span v-if="row.original.downSince" class="font-mono text-red-600">
            {{ formatDuration(now.getTime() - row.original.downSince) }}
          </span>
          <span v-else class="text-slate-400">—</span>
        </template>
        <template #empty>
          <div class="py-10 text-center text-sm text-slate-500">
            No monitors yet.
            <NuxtLink to="/monitors/new" class="underline">Add one</NuxtLink>
            or
            <NuxtLink to="/monitors/bulk" class="underline">bulk add</NuxtLink>.
          </div>
        </template>
      </UTable>
    </UCard>
  </div>
</template>
```

- [ ] **Step 4: Verify**

Run `npm run typecheck`, then `npm run dev` and open `http://localhost:3000/`. Expected: header counts, empty-state message with links (or the monitor created in Task 10 with an Up pill); the "Last check" text ticks every second; the list refreshes every 15s (Network tab shows `/api/monitors`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): status board"
```

---

### Task 14: Monitor form (add / edit), Launch watch and bulk add

**Files:**
- Create: `app/components/MonitorForm.vue`, `app/pages/monitors/new.vue`, `app/pages/monitors/[id]/edit.vue`, `app/pages/monitors/bulk.vue`

**Interfaces:**
- Consumes: `monitorInputSchema`, `MonitorInput` (Task 10); `parseBulk`, `BulkRow` (Task 10); `INTERVALS_S`, `REMINDER_MINS`, `MONITOR_DEFAULTS`, `LAUNCH_WATCH` (Task 2); `GET /api/contacts` → `{ contacts: ContactListItem[] }` (Task 11); `POST /api/monitors`, `GET/PUT/DELETE /api/monitors/:id`, `POST /api/monitors/test-url`, `POST /api/monitors/bulk` (Task 10); `errorMessage` (Task 13)
- Produces: `<MonitorForm :initial :submit-label :is-new @submit="(input: MonitorInput) => …" />`

- [ ] **Step 1: Write `app/components/MonitorForm.vue`**

```vue
<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { ContactListItem } from '~~/server/utils/contacts'
import { INTERVALS_S, LAUNCH_WATCH, REMINDER_MINS } from '~~/shared/utils/constants'
import { formatInterval } from '~~/shared/utils/format'
import { monitorInputSchema, type MonitorInput } from '~~/shared/utils/validation'

const props = defineProps<{ initial: MonitorInput; submitLabel: string; isNew?: boolean }>()
const emit = defineEmits<{ submit: [input: MonitorInput] }>()

const state = reactive<MonitorInput>({ ...props.initial, contactIds: [...props.initial.contactIds] })
const saving = ref(false)

const timeoutS = computed({
  get: () => state.timeoutMs / 1000,
  set: (v: number) => {
    state.timeoutMs = Math.round((v || 10) * 1000)
  }
})

const { data: contactData } = await useFetch<{ contacts: ContactListItem[] }>('/api/contacts')
const contacts = computed(() => contactData.value?.contacts ?? [])
if (props.isNew) {
  watch(
    contacts,
    (list) => {
      if (state.contactIds.length === 0) state.contactIds = list.filter((c) => c.isDefault).map((c) => c.id)
    },
    { immediate: true }
  )
}

const intervalItems = INTERVALS_S.map((v) => ({ label: `Every ${formatInterval(v)}`, value: v }))
const reminderItems = REMINDER_MINS.map((v) => ({ label: v === 0 ? 'Off' : `Every ${v} min`, value: v }))
const thresholdItems = Array.from({ length: 10 }, (_, i) => ({
  label: i === 0 ? '1 confirmed failure (alert immediately)' : `${i + 1} confirmed failures in a row`,
  value: i + 1
}))

function applyLaunchWatch() {
  state.intervalS = LAUNCH_WATCH.intervalS
  state.failThreshold = LAUNCH_WATCH.failThreshold
}

function toggleContact(id: string, on: boolean) {
  state.contactIds = on ? [...new Set([...state.contactIds, id])] : state.contactIds.filter((c) => c !== id)
}

interface TestResult {
  ok: boolean
  statusCode: number | null
  responseMs: number | null
  error: string | null
}
const testing = ref(false)
const testResult = ref<TestResult | null>(null)

async function testUrl() {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await $fetch<TestResult>('/api/monitors/test-url', {
      method: 'POST',
      body: { url: state.url, timeoutMs: state.timeoutMs }
    })
  } catch (e) {
    useToast().add({ title: 'Could not test URL', description: errorMessage(e), color: 'error' })
  } finally {
    testing.value = false
  }
}

async function onSubmit(e: FormSubmitEvent<MonitorInput>) {
  saving.value = true
  try {
    emit('submit', e.data)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UForm :schema="monitorInputSchema" :state="state" class="space-y-5" @submit="onSubmit">
    <UFormField label="Name" name="name" required>
      <UInput v-model="state.name" placeholder="Acme Ltd — main site" class="w-full" />
    </UFormField>

    <UFormField label="URL" name="url" required>
      <div class="flex gap-2">
        <UInput v-model="state.url" placeholder="https://www.example.co.uk" class="flex-1 font-mono" />
        <UButton variant="outline" :loading="testing" :disabled="!state.url" @click="testUrl">Test URL</UButton>
      </div>
    </UFormField>
    <UAlert
      v-if="testResult"
      :color="testResult.ok ? 'success' : 'error'"
      variant="subtle"
      :title="
        testResult.ok
          ? `Up — HTTP ${testResult.statusCode} in ${testResult.responseMs} ms`
          : `Down — ${testResult.error}`
      "
    />

    <div class="flex items-center justify-between gap-4 rounded-md border border-slate-200 bg-white p-3">
      <div>
        <div class="text-sm font-medium">Launch watch</div>
        <div class="text-xs text-slate-500">
          For newly launched sites: check every minute and alert on the first confirmed failure.
        </div>
      </div>
      <UButton variant="soft" icon="i-lucide-rocket" @click="applyLaunchWatch">Apply</UButton>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField label="Check interval" name="intervalS">
        <USelect v-model="state.intervalS" :items="intervalItems" class="w-full" />
      </UFormField>
      <UFormField label="Timeout (seconds)" name="timeoutMs">
        <UInputNumber v-model="timeoutS" :min="1" :max="30" class="w-full" />
      </UFormField>
      <UFormField label="Alert after" name="failThreshold" help="Every failure is re-checked from a second region first.">
        <USelect v-model="state.failThreshold" :items="thresholdItems" class="w-full" />
      </UFormField>
      <UFormField label="Reminder while down" name="reminderMins">
        <USelect v-model="state.reminderMins" :items="reminderItems" class="w-full" />
      </UFormField>
    </div>

    <UFormField label="Alert contacts" name="contactIds">
      <div v-if="contacts.length" class="space-y-2">
        <UCheckbox
          v-for="c in contacts"
          :key="c.id"
          :model-value="state.contactIds.includes(c.id)"
          :label="`${c.name} (${c.type === 'slack' ? 'Slack' : 'Email'})`"
          @update:model-value="(v) => toggleContact(c.id, v === true)"
        />
      </div>
      <p v-else class="text-sm text-slate-500">
        No contacts yet — <NuxtLink to="/contacts" class="underline">add one</NuxtLink> so alerts go somewhere.
      </p>
    </UFormField>

    <USwitch v-model="state.paused" label="Paused" />

    <div class="flex justify-end gap-2">
      <UButton variant="ghost" color="neutral" @click="$router.back()">Cancel</UButton>
      <UButton type="submit" :loading="saving">{{ submitLabel }}</UButton>
    </div>
  </UForm>
</template>
```

- [ ] **Step 2: Write `app/pages/monitors/new.vue`**

```vue
<script setup lang="ts">
import { MONITOR_DEFAULTS } from '~~/shared/utils/constants'
import type { MonitorInput } from '~~/shared/utils/validation'

const initial: MonitorInput = { ...MONITOR_DEFAULTS, name: '', url: '', contactIds: [] }

async function create(input: MonitorInput) {
  try {
    const { id } = await $fetch<{ id: string }>('/api/monitors', { method: 'POST', body: input })
    await navigateTo(`/monitors/${id}`)
  } catch (e) {
    useToast().add({ title: 'Could not save monitor', description: errorMessage(e), color: 'error' })
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-4">
    <h1 class="text-xl font-semibold">Add monitor</h1>
    <UCard>
      <MonitorForm :initial="initial" submit-label="Add monitor" is-new @submit="create" />
    </UCard>
  </div>
</template>
```

- [ ] **Step 3: Write `app/pages/monitors/[id]/edit.vue`**

```vue
<script setup lang="ts">
import type { MonitorRow } from '~~/server/db/schema'
import type { MonitorInput } from '~~/shared/utils/validation'

const route = useRoute()
const id = route.params.id as string
const { data: monitor, error } = await useFetch<MonitorRow & { contactIds: string[] }>(`/api/monitors/${id}`)

const initial = computed<MonitorInput | null>(() =>
  monitor.value
    ? {
        name: monitor.value.name,
        url: monitor.value.url,
        intervalS: monitor.value.intervalS,
        timeoutMs: monitor.value.timeoutMs,
        failThreshold: monitor.value.failThreshold,
        reminderMins: monitor.value.reminderMins,
        paused: monitor.value.paused,
        contactIds: monitor.value.contactIds
      }
    : null
)

async function save(input: MonitorInput) {
  try {
    await $fetch(`/api/monitors/${id}`, { method: 'PUT', body: input })
    await navigateTo(`/monitors/${id}`)
  } catch (e) {
    useToast().add({ title: 'Could not save monitor', description: errorMessage(e), color: 'error' })
  }
}

const confirmDelete = ref(false)
const deleting = ref(false)
async function remove() {
  deleting.value = true
  try {
    await $fetch(`/api/monitors/${id}`, { method: 'DELETE' })
    await navigateTo('/')
  } catch (e) {
    useToast().add({ title: 'Could not delete monitor', description: errorMessage(e), color: 'error' })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-4">
    <UAlert v-if="error" color="error" variant="subtle" title="Monitor not found" />
    <template v-else-if="initial">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold">Edit {{ monitor!.name }}</h1>
        <UButton color="error" variant="ghost" icon="i-lucide-trash-2" @click="confirmDelete = true">Delete</UButton>
      </div>
      <UCard>
        <MonitorForm :initial="initial" submit-label="Save changes" @submit="save" />
      </UCard>
    </template>

    <UModal v-model:open="confirmDelete" title="Delete monitor?">
      <template #body>
        <p class="text-sm">This stops monitoring and permanently deletes its check history and incidents.</p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="confirmDelete = false">Cancel</UButton>
          <UButton color="error" :loading="deleting" @click="remove">Delete</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
```

- [ ] **Step 4: Write `app/pages/monitors/bulk.vue`**

```vue
<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { parseBulk, type BulkRow } from '~~/shared/utils/bulk'

const text = ref('')
const rows = computed(() => parseBulk(text.value))
const errors = computed(() => rows.value.filter((r) => r.error).length)
const submitting = ref(false)

const columns: TableColumn<BulkRow>[] = [
  { accessorKey: 'line', header: 'Line' },
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'url', header: 'URL' },
  { id: 'result', header: '' }
]

async function submit() {
  submitting.value = true
  try {
    const { created } = await $fetch<{ created: number }>('/api/monitors/bulk', {
      method: 'POST',
      body: { text: text.value }
    })
    useToast().add({ title: `Added ${created} monitors`, color: 'success' })
    await navigateTo('/')
  } catch (e) {
    useToast().add({ title: 'Could not add monitors', description: errorMessage(e), color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-4">
    <div>
      <h1 class="text-xl font-semibold">Bulk add monitors</h1>
      <p class="text-sm text-slate-500">
        One site per line as <code class="font-mono">name, url</code>. Blank lines and lines starting with
        <code class="font-mono">#</code> are ignored. New monitors use the default settings (every 5 min, alert
        after 2 failures) and your default contacts — edit any of them afterwards.
      </p>
    </div>
    <UTextarea
      v-model="text"
      :rows="10"
      class="w-full font-mono"
      placeholder="Acme Ltd, https://www.acme.co.uk&#10;Beta Bakery, https://betabakery.com"
    />
    <UCard v-if="rows.length" :ui="{ body: 'p-0 sm:p-0' }">
      <UTable :data="rows" :columns="columns">
        <template #url-cell="{ row }">
          <span class="font-mono text-xs">{{ row.original.url }}</span>
        </template>
        <template #result-cell="{ row }">
          <span v-if="row.original.error" class="text-sm text-red-600">{{ row.original.error }}</span>
          <UIcon v-else name="i-lucide-check" class="text-emerald-600" />
        </template>
      </UTable>
    </UCard>
    <div class="flex items-center justify-end gap-3">
      <span v-if="errors" class="text-sm text-red-600">{{ errors }} line(s) need fixing</span>
      <UButton :disabled="!rows.length || errors > 0" :loading="submitting" @click="submit">
        Add {{ rows.length }} monitors
      </UButton>
    </div>
  </div>
</template>
```

- [ ] **Step 5: Verify**

Run `npm run typecheck`. Then with `npm run dev`:
1. `/monitors/new`: type `example.com` in URL → submitting shows "Enter a full http:// or https:// URL". Fix to `https://example.com`, click **Test URL** → green "Up — HTTP 200 in N ms". Click **Launch watch → Apply** → interval shows "Every 1m" and threshold "1 confirmed failure". Save → lands on `/monitors/<id>` (404 page until Task 15 — expected).
2. `/monitors/<id>/edit`: values pre-filled; change name, save; Delete opens the modal (cancel it).
3. `/monitors/bulk`: paste `Acme, https://example.com\nbad line` → second row shows "Expected: name, url" and the button is disabled; remove it → **Add 1 monitors** → toast and back on the board.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): monitor add/edit form with launch watch, URL test and bulk add"
```

---

### Task 15: Site detail page and response-time chart

**Files:**
- Create: `app/components/ResponseChart.vue`, `app/pages/monitors/[id]/index.vue`

**Interfaces:**
- Consumes: `GET /api/monitors/:id/history` → `{ monitor: MonitorRow & { contactIds }, uptime: { h24, d7, d30 }, series: { h24, d7 }, incidents, checks, deliveries, maintenance }` (Task 12); `POST /api/monitors/:id/check|pause|resume` (Task 10); `StatusPill`, `errorMessage`, `formatDateTime` (Task 13)
- Produces: `<ResponseChart :points="{ t: number; avgMs: number }[]" :from="number" :to="number" />`

- [ ] **Step 1: Load the `dataviz` skill**

Invoke the `dataviz` skill before writing the chart and apply its guidance (palette, axis, empty state). The component below is the baseline; adjust styling to the skill, keeping the props interface unchanged.

- [ ] **Step 2: Write `app/components/ResponseChart.vue`**

```vue
<script setup lang="ts">
const props = defineProps<{ points: { t: number; avgMs: number }[]; from: number; to: number }>()

const W = 640
const H = 160
const PAD = { top: 12, right: 8, bottom: 22, left: 44 }

const maxMs = computed(() => Math.max(100, ...props.points.map((p) => p.avgMs)) * 1.1)
const x = (t: number) => PAD.left + ((t - props.from) / (props.to - props.from)) * (W - PAD.left - PAD.right)
const y = (ms: number) => PAD.top + (1 - ms / maxMs.value) * (H - PAD.top - PAD.bottom)
const path = computed(() => props.points.map((p) => `${x(p.t).toFixed(1)},${y(p.avgMs).toFixed(1)}`).join(' '))
const ticks = computed(() => [0, Math.round(maxMs.value / 2), Math.round(maxMs.value)])
const label = (t: number) =>
  new Date(t).toLocaleString('en-GB', props.to - props.from > 86_400_000 ? { weekday: 'short', day: 'numeric' } : { hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <div>
    <svg
      v-if="points.length > 1"
      :viewBox="`0 0 ${W} ${H}`"
      class="h-40 w-full"
      role="img"
      :aria-label="`Average response time, ${points.length} data points`"
    >
      <g v-for="tick in ticks" :key="tick">
        <line :x1="PAD.left" :x2="W - PAD.right" :y1="y(tick)" :y2="y(tick)" stroke="#e2e8f0" stroke-width="1" />
        <text :x="PAD.left - 6" :y="y(tick) + 4" text-anchor="end" class="fill-slate-400 font-mono text-[10px]">
          {{ tick }}ms
        </text>
      </g>
      <polyline :points="path" fill="none" stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round" />
      <text :x="PAD.left" :y="H - 4" class="fill-slate-400 text-[10px]">{{ label(from) }}</text>
      <text :x="W - PAD.right" :y="H - 4" text-anchor="end" class="fill-slate-400 text-[10px]">{{ label(to) }}</text>
    </svg>
    <div v-else class="flex h-40 items-center justify-center text-sm text-slate-400">Not enough data yet</div>
  </div>
</template>
```

- [ ] **Step 3: Write `app/pages/monitors/[id]/index.vue`**

```vue
<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { CheckRow, IncidentRow, MaintenanceRow, MonitorRow } from '~~/server/db/schema'
import { formatDuration, formatInterval } from '~~/shared/utils/format'

interface DeliveryItem {
  id: string
  kind: string
  attempt: number
  ok: boolean
  error: string | null
  sentAt: number
  contactName: string
}
interface History {
  monitor: MonitorRow & { contactIds: string[] }
  uptime: { h24: number | null; d7: number | null; d30: number | null }
  series: { h24: { t: number; avgMs: number }[]; d7: { t: number; avgMs: number }[] }
  incidents: IncidentRow[]
  checks: CheckRow[]
  deliveries: DeliveryItem[]
  maintenance: MaintenanceRow[]
}

const route = useRoute()
const id = route.params.id as string
const { data, error, refresh } = await useFetch<History>(`/api/monitors/${id}/history`)
useIntervalFn(() => refresh(), 30_000)
const now = useNow({ interval: 1000 })

const m = computed(() => data.value?.monitor)
const inMaintenance = computed(() =>
  (data.value?.maintenance ?? []).some((w) => w.startsAt <= now.value.getTime() && w.endsAt > now.value.getTime())
)
const range = ref<'h24' | 'd7'>('h24')
const rangeItems = [
  { label: '24 hours', value: 'h24' },
  { label: '7 days', value: 'd7' }
]
const chartTo = computed(() => now.value.getTime())
const chartFrom = computed(() => chartTo.value - (range.value === 'h24' ? 86_400_000 : 7 * 86_400_000))

const busy = ref(false)
async function act(path: 'check' | 'pause' | 'resume', done: string) {
  busy.value = true
  try {
    await $fetch(`/api/monitors/${id}/${path}`, { method: 'POST' })
    useToast().add({ title: done, color: 'success' })
    setTimeout(() => refresh(), path === 'check' ? 4000 : 0)
  } catch (e) {
    useToast().add({ title: 'Action failed', description: errorMessage(e), color: 'error' })
  } finally {
    busy.value = false
  }
}

const pct = (v: number | null) => (v == null ? '—' : `${v}%`)

const incidentColumns: TableColumn<IncidentRow>[] = [
  { id: 'started', header: 'Started' },
  { id: 'resolved', header: 'Resolved' },
  { id: 'duration', header: 'Duration' },
  { accessorKey: 'cause', header: 'Cause' }
]
const checkColumns: TableColumn<CheckRow>[] = [
  { id: 'time', header: 'Time' },
  { id: 'result', header: 'Result' },
  { accessorKey: 'region', header: 'Region' },
  { id: 'response', header: 'Response' },
  { id: 'detail', header: 'Detail' }
]
const deliveryColumns: TableColumn<DeliveryItem>[] = [
  { id: 'time', header: 'Time' },
  { accessorKey: 'contactName', header: 'Contact' },
  { accessorKey: 'kind', header: 'Alert' },
  { id: 'result', header: 'Result' }
]
</script>

<template>
  <div class="space-y-6">
    <UAlert v-if="error" color="error" variant="subtle" title="Monitor not found" />
    <template v-else-if="data && m">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="space-y-1">
          <div class="flex items-center gap-3">
            <h1 class="text-xl font-semibold">{{ m.name }}</h1>
            <StatusPill :status="m.status" :in-maintenance="inMaintenance" />
          </div>
          <a :href="m.url" target="_blank" rel="noopener" class="font-mono text-sm text-slate-500 hover:underline">
            {{ m.url }}
          </a>
          <p class="text-xs text-slate-400">
            Every {{ formatInterval(m.intervalS) }} · alert after {{ m.failThreshold }} confirmed failure(s) ·
            reminders {{ m.reminderMins ? `every ${m.reminderMins} min` : 'off' }}
          </p>
        </div>
        <div class="flex gap-2">
          <UButton variant="outline" icon="i-lucide-refresh-cw" :disabled="m.paused" :loading="busy" @click="act('check', 'Check queued')">
            Check now
          </UButton>
          <UButton
            v-if="m.paused"
            variant="outline"
            icon="i-lucide-play"
            :loading="busy"
            @click="act('resume', 'Monitoring resumed')"
          >
            Resume
          </UButton>
          <UButton v-else variant="outline" icon="i-lucide-pause" :loading="busy" @click="act('pause', 'Monitoring paused')">
            Pause
          </UButton>
          <UButton :to="`/monitors/${id}/edit`" icon="i-lucide-pencil">Edit</UButton>
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-3">
        <UCard v-for="(label, key) in { h24: 'Last 24 hours', d7: 'Last 7 days', d30: 'Last 30 days' }" :key="key">
          <div class="text-xs text-slate-500">{{ label }}</div>
          <div class="font-mono text-2xl font-semibold">{{ pct(data.uptime[key]) }}</div>
          <div class="text-xs text-slate-400">uptime</div>
        </UCard>
      </div>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-medium">Response time</span>
            <USelect v-model="range" :items="rangeItems" class="w-32" />
          </div>
        </template>
        <ResponseChart :points="data.series[range]" :from="chartFrom" :to="chartTo" />
      </UCard>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <template #header><span class="font-medium">Incidents</span></template>
        <UTable :data="data.incidents" :columns="incidentColumns">
          <template #started-cell="{ row }">{{ formatDateTime(row.original.startedAt) }}</template>
          <template #resolved-cell="{ row }">
            <span v-if="row.original.resolvedAt">{{ formatDateTime(row.original.resolvedAt) }}</span>
            <UBadge v-else color="error" variant="subtle">Ongoing</UBadge>
          </template>
          <template #duration-cell="{ row }">
            <span class="font-mono">
              {{ formatDuration((row.original.resolvedAt ?? now.getTime()) - row.original.startedAt) }}
            </span>
          </template>
          <template #empty><div class="py-6 text-center text-sm text-slate-400">No incidents</div></template>
        </UTable>
      </UCard>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <template #header><span class="font-medium">Recent checks</span></template>
        <UTable :data="data.checks" :columns="checkColumns">
          <template #time-cell="{ row }">{{ formatDateTime(row.original.checkedAt) }}</template>
          <template #result-cell="{ row }">
            <UBadge :color="row.original.ok ? 'success' : row.original.confirmed ? 'error' : 'warning'" variant="subtle">
              {{ row.original.ok ? 'Up' : row.original.confirmed ? 'Down' : 'Blip' }}
            </UBadge>
            <span v-if="row.original.maintenance" class="ml-1 text-xs text-slate-400">maintenance</span>
          </template>
          <template #response-cell="{ row }">
            <span class="font-mono">{{ row.original.responseMs != null ? `${row.original.responseMs} ms` : '—' }}</span>
          </template>
          <template #detail-cell="{ row }">
            <span class="font-mono text-xs">{{ row.original.error ?? `HTTP ${row.original.statusCode}` }}</span>
          </template>
          <template #empty><div class="py-6 text-center text-sm text-slate-400">No checks yet</div></template>
        </UTable>
      </UCard>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <template #header><span class="font-medium">Alert deliveries</span></template>
        <UTable :data="data.deliveries" :columns="deliveryColumns">
          <template #time-cell="{ row }">{{ formatDateTime(row.original.sentAt) }}</template>
          <template #result-cell="{ row }">
            <UBadge v-if="row.original.ok" color="success" variant="subtle">Sent</UBadge>
            <span v-else class="text-sm text-red-600">
              Attempt {{ row.original.attempt }} failed: {{ row.original.error }}
            </span>
          </template>
          <template #empty><div class="py-6 text-center text-sm text-slate-400">No alerts sent</div></template>
        </UTable>
      </UCard>

      <UCard v-if="data.maintenance.length">
        <template #header><span class="font-medium">Maintenance windows</span></template>
        <ul class="space-y-1 text-sm">
          <li v-for="w in data.maintenance" :key="w.id">
            {{ formatDateTime(w.startsAt) }} → {{ formatDateTime(w.endsAt) }}
            <span v-if="!w.monitorId" class="text-xs text-slate-400">(all sites)</span>
            <span v-if="w.note" class="text-slate-500">— {{ w.note }}</span>
          </li>
        </ul>
      </UCard>
    </template>
  </div>
</template>
```

- [ ] **Step 4: Verify**

Run `npm run typecheck`. With `npm run dev`, open a monitor from the board. Expected: header with pill and settings line; three uptime tiles; chart (or "Not enough data yet" for a fresh monitor — set its interval to 30s and wait two minutes to see a line); recent checks list grows; **Check now** adds a row within ~5s; **Pause** flips the pill to Paused and disables Check now; **Resume** returns it to Pending then Up.

To see the DOWN path end to end locally: edit the monitor URL to `https://httpstat.us/503` with Launch watch applied → within a minute the pill shows Down, an Ongoing incident appears, and (if a contact is linked) a delivery row appears. Change the URL back → Recovered.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): site detail page with uptime, response chart, incidents and deliveries"
```

---

### Task 16: Contacts and maintenance pages

**Files:**
- Create: `app/pages/contacts.vue`, `app/pages/maintenance.vue`

**Interfaces:**
- Consumes: `GET/POST /api/contacts`, `PUT/DELETE /api/contacts/:id`, `POST /api/contacts/:id/test` (Task 11); `GET/POST /api/maintenance`, `DELETE /api/maintenance/:id` (Task 11); `GET /api/monitors` (Task 12); `contactCreateSchema`, `maintenanceSchema` (Task 11); `formatDateTime`, `toLocalInput`, `fromLocalInput`, `errorMessage` (Task 13)

- [ ] **Step 1: Write `app/pages/contacts.vue`**

```vue
<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { ContactListItem } from '~~/server/utils/contacts'

const { data, refresh } = await useFetch<{ contacts: ContactListItem[] }>('/api/contacts')
const contacts = computed(() => data.value?.contacts ?? [])
const toast = useToast()

const open = ref(false)
const editing = ref<ContactListItem | null>(null)
const form = reactive({ type: 'slack' as 'slack' | 'email', name: '', target: '', isDefault: false })
const saving = ref(false)

function startCreate() {
  editing.value = null
  Object.assign(form, { type: 'slack', name: '', target: '', isDefault: true })
  open.value = true
}
function startEdit(c: ContactListItem) {
  editing.value = c
  Object.assign(form, { type: c.type, name: c.name, target: '', isDefault: c.isDefault })
  open.value = true
}

async function save() {
  saving.value = true
  try {
    if (editing.value) {
      await $fetch(`/api/contacts/${editing.value.id}`, {
        method: 'PUT',
        body: { name: form.name, isDefault: form.isDefault, target: form.target || undefined }
      })
    } else {
      await $fetch('/api/contacts', { method: 'POST', body: { ...form } })
    }
    open.value = false
    await refresh()
  } catch (e) {
    toast.add({ title: 'Could not save contact', description: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function sendTest(c: ContactListItem) {
  try {
    const r = await $fetch<{ ok: boolean; error: string | null }>(`/api/contacts/${c.id}/test`, { method: 'POST' })
    toast.add(
      r.ok
        ? { title: `Test alert sent to ${c.name}`, color: 'success' }
        : { title: `Test alert to ${c.name} failed`, description: r.error ?? undefined, color: 'error' }
    )
    await refresh()
  } catch (e) {
    toast.add({ title: 'Could not send test alert', description: errorMessage(e), color: 'error' })
  }
}

const deleting = ref<ContactListItem | null>(null)
async function confirmDelete() {
  if (!deleting.value) return
  try {
    await $fetch(`/api/contacts/${deleting.value.id}`, { method: 'DELETE' })
    deleting.value = null
    await refresh()
  } catch (e) {
    toast.add({ title: 'Could not delete contact', description: errorMessage(e), color: 'error' })
  }
}

const typeItems = [
  { label: 'Slack channel (incoming webhook)', value: 'slack' },
  { label: 'Email', value: 'email' }
]
const columns: TableColumn<ContactListItem>[] = [
  { accessorKey: 'name', header: 'Name' },
  { id: 'target', header: 'Destination' },
  { id: 'usage', header: 'Used by' },
  { id: 'last', header: 'Last delivery' },
  { id: 'actions', header: '' }
]
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-end justify-between">
      <div>
        <h1 class="text-xl font-semibold">Contacts</h1>
        <p class="text-sm text-slate-500">Where alerts go. Default contacts are pre-ticked on new monitors.</p>
      </div>
      <UButton icon="i-lucide-plus" @click="startCreate">Add contact</UButton>
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <UTable :data="contacts" :columns="columns">
        <template #name-cell="{ row }">
          <span class="font-medium">{{ row.original.name }}</span>
          <UBadge v-if="row.original.isDefault" variant="subtle" color="neutral" class="ml-2">Default</UBadge>
        </template>
        <template #target-cell="{ row }">
          <UIcon :name="row.original.type === 'slack' ? 'i-lucide-hash' : 'i-lucide-mail'" class="mr-1 align-middle" />
          <span class="font-mono text-xs">{{ row.original.targetMasked }}</span>
        </template>
        <template #usage-cell="{ row }">
          <UTooltip v-if="row.original.monitors.length" :text="row.original.monitors.map((m) => m.name).join(', ')">
            <span>{{ row.original.monitors.length }} site(s)</span>
          </UTooltip>
          <span v-else class="text-slate-400">No sites</span>
        </template>
        <template #last-cell="{ row }">
          <template v-if="row.original.lastDelivery">
            <UBadge v-if="row.original.lastDelivery.ok" color="success" variant="subtle">Delivered</UBadge>
            <UTooltip v-else :text="row.original.lastDelivery.error ?? ''">
              <UBadge color="error" variant="subtle">Failed</UBadge>
            </UTooltip>
            <span class="ml-1 text-xs text-slate-400">{{ formatDateTime(row.original.lastDelivery.at) }}</span>
          </template>
          <span v-else class="text-slate-400">—</span>
        </template>
        <template #actions-cell="{ row }">
          <div class="flex justify-end gap-1">
            <UButton size="xs" variant="ghost" icon="i-lucide-send" @click="sendTest(row.original)">Test</UButton>
            <UButton size="xs" variant="ghost" icon="i-lucide-pencil" @click="startEdit(row.original)" />
            <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="deleting = row.original" />
          </div>
        </template>
        <template #empty>
          <div class="py-10 text-center text-sm text-slate-500">No contacts yet. Add a Slack channel or email.</div>
        </template>
      </UTable>
    </UCard>

    <UModal v-model:open="open" :title="editing ? `Edit ${editing.name}` : 'Add contact'">
      <template #body>
        <div class="space-y-4">
          <UFormField v-if="!editing" label="Type">
            <USelect v-model="form.type" :items="typeItems" class="w-full" />
          </UFormField>
          <UFormField label="Name">
            <UInput v-model="form.name" :placeholder="form.type === 'slack' ? '#dev-alerts' : 'Support inbox'" class="w-full" />
          </UFormField>
          <UFormField
            :label="form.type === 'slack' ? 'Webhook URL' : 'Email address'"
            :help="
              form.type === 'slack'
                ? 'Slack → Apps → Incoming Webhooks → Add to channel. Starts with https://hooks.slack.com/'
                : undefined
            "
          >
            <UInput
              v-model="form.target"
              :placeholder="editing ? `Leave blank to keep ${editing.targetMasked}` : ''"
              class="w-full font-mono"
            />
          </UFormField>
          <UCheckbox v-model="form.isDefault" label="Default — pre-tick on new monitors and bulk-added sites" />
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="open = false">Cancel</UButton>
          <UButton :loading="saving" @click="save">Save</UButton>
        </div>
      </template>
    </UModal>

    <UModal :open="!!deleting" title="Delete contact?" @update:open="(v) => !v && (deleting = null)">
      <template #body>
        <p class="text-sm">
          {{ deleting?.name }} will stop receiving alerts for {{ deleting?.monitors.length ?? 0 }} site(s).
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="deleting = null">Cancel</UButton>
          <UButton color="error" @click="confirmDelete">Delete</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
```

- [ ] **Step 2: Write `app/pages/maintenance.vue`**

```vue
<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { BoardRow } from '~~/server/utils/stats'
import type { MaintenanceListItem } from '~~/server/utils/maintenance'

const { data, refresh } = await useFetch<{ windows: MaintenanceListItem[] }>('/api/maintenance')
const { data: board } = await useFetch<{ monitors: BoardRow[] }>('/api/monitors')
const toast = useToast()
const now = useNow({ interval: 30_000 })

const ALL = '__all__'
const monitorItems = computed(() => [
  { label: 'All sites', value: ALL },
  ...(board.value?.monitors ?? []).map((m) => ({ label: m.name, value: m.id }))
])

const start = Date.now()
const form = reactive({
  monitorId: ALL,
  startsAt: toLocalInput(start),
  endsAt: toLocalInput(start + 60 * 60_000),
  note: ''
})
const saving = ref(false)

async function create() {
  saving.value = true
  try {
    await $fetch('/api/maintenance', {
      method: 'POST',
      body: {
        monitorId: form.monitorId === ALL ? null : form.monitorId,
        startsAt: fromLocalInput(form.startsAt),
        endsAt: fromLocalInput(form.endsAt),
        note: form.note
      }
    })
    form.note = ''
    await refresh()
    toast.add({ title: 'Maintenance window scheduled', color: 'success' })
  } catch (e) {
    toast.add({ title: 'Could not schedule maintenance', description: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function remove(w: MaintenanceListItem) {
  try {
    await $fetch(`/api/maintenance/${w.id}`, { method: 'DELETE' })
    await refresh()
  } catch (e) {
    toast.add({ title: 'Could not delete window', description: errorMessage(e), color: 'error' })
  }
}

function phase(w: MaintenanceListItem): { label: string; color: 'info' | 'warning' | 'neutral' } {
  const t = now.value.getTime()
  if (w.endsAt <= t) return { label: 'Ended', color: 'neutral' }
  if (w.startsAt <= t) return { label: 'Active', color: 'warning' }
  return { label: 'Upcoming', color: 'info' }
}

const columns: TableColumn<MaintenanceListItem>[] = [
  { id: 'site', header: 'Site' },
  { id: 'when', header: 'When' },
  { id: 'phase', header: '' },
  { accessorKey: 'note', header: 'Note' },
  { accessorKey: 'createdBy', header: 'By' },
  { id: 'actions', header: '' }
]
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-semibold">Maintenance</h1>
      <p class="text-sm text-slate-500">
        Checks keep running during a window but no alerts are sent and it doesn't count against uptime.
      </p>
    </div>

    <UCard>
      <div class="grid gap-4 sm:grid-cols-4">
        <UFormField label="Site">
          <USelect v-model="form.monitorId" :items="monitorItems" class="w-full" />
        </UFormField>
        <UFormField label="Start">
          <UInput v-model="form.startsAt" type="datetime-local" class="w-full" />
        </UFormField>
        <UFormField label="End">
          <UInput v-model="form.endsAt" type="datetime-local" class="w-full" />
        </UFormField>
        <UFormField label="Note">
          <UInput v-model="form.note" placeholder="WordPress core update" class="w-full" />
        </UFormField>
      </div>
      <div class="mt-4 flex justify-end">
        <UButton icon="i-lucide-calendar-plus" :loading="saving" @click="create">Schedule</UButton>
      </div>
    </UCard>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <UTable :data="data?.windows ?? []" :columns="columns">
        <template #site-cell="{ row }">{{ row.original.monitorName ?? 'All sites' }}</template>
        <template #when-cell="{ row }">
          {{ formatDateTime(row.original.startsAt) }} → {{ formatDateTime(row.original.endsAt) }}
        </template>
        <template #phase-cell="{ row }">
          <UBadge :color="phase(row.original).color" variant="subtle">{{ phase(row.original).label }}</UBadge>
        </template>
        <template #actions-cell="{ row }">
          <UButton
            v-if="phase(row.original).label !== 'Ended'"
            size="xs"
            variant="ghost"
            color="error"
            icon="i-lucide-trash-2"
            @click="remove(row.original)"
          />
        </template>
        <template #empty><div class="py-8 text-center text-sm text-slate-400">No maintenance windows</div></template>
      </UTable>
    </UCard>
  </div>
</template>
```

- [ ] **Step 3: Verify**

Run `npm run typecheck && npm run lint && npm test`. With `npm run dev`:
1. `/contacts`: add an email contact with your own address (needs `RESEND_API_KEY` in `.env`) → **Test** → toast "Test alert sent" and the email arrives; the Last delivery column shows Delivered. Add a Slack contact with `https://hooks.slack.com/services/invalid` → **Test** → "failed" toast with `Slack responded 4xx`, Last delivery shows Failed. Edit it with a blank webhook → name changes, masked target unchanged.
2. `/maintenance`: try end before start → error toast "End must be after start". Schedule a 1-hour window for one site → appears as Active; the board shows that site's pill as Maintenance.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): contacts and maintenance pages"
```

---

### Task 17: README, deploy runbook and staging deploy

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a runbook a teammate can follow; a live staging deploy (only with the user's go-ahead and credentials).

- [ ] **Step 1: Write `README.md`**

````markdown
# Hiyield Uptime

Internal uptime monitor for Hiyield client sites. Spec: `docs/superpowers/specs/2026-10-06-uptime-monitor-design.md`.

## How it works

- One **MonitorDO** (Durable Object) per site runs its own alarm loop: check → if failed, confirm via **ProbeDO** (eastern US) → `evaluate()` decides → write D1 → alert.
- Alerts go to **contacts** (Slack incoming webhooks, email via Resend) linked per site.
- `/health` returns 500 if any active monitor stops checking. An external pinger watches it.
- Crons: every 10 min reload any quiet monitor; daily 03:00 UTC prune checks older than 90 days.

## Local development

```bash
cp .env.example .env    # fill in values — see below
npm install
npm run dev             # nuxt dev on :3000 + engine sidecar (Durable Objects) on :8787
```

- `nuxt dev` can't host Durable Objects, so DO calls are forwarded to the sidecar (`wrangler.dev.jsonc`). Both share the local D1.
- Full production-like loop (built worker, real bindings): `npm run cf:dev` → http://localhost:8787.

### Google sign-in

Google Cloud console (Hiyield Workspace) → APIs & Services → Credentials → OAuth client ID → Web application.
Authorised redirect URIs:
- `http://localhost:3000/api/auth/callback/google`
- `https://<staging host>/api/auth/callback/google`
- `https://<production host>/api/auth/callback/google`

Set the OAuth consent screen to **Internal**. Only `@hiyield.co.uk` accounts can sign in (enforced server-side too).

## Tests

```bash
npm test                  # unit (node, in-memory SQLite from the real migrations)
npm run test:integration  # Durable Objects inside workerd (@cloudflare/vitest-pool-workers)
```

## Deploy

One-time per environment (`staging` shown; repeat with `production` and `hiyield-uptime`):

```bash
npx wrangler d1 create hiyield-uptime-staging     # paste database_id into wrangler.jsonc → env.staging
npx wrangler secret put BETTER_AUTH_SECRET --env staging     # openssl rand -hex 32
npx wrangler secret put GOOGLE_CLIENT_ID --env staging
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
npx wrangler secret put RESEND_API_KEY --env staging
npx wrangler secret put ADMIN_API_SECRET --env staging       # openssl rand -hex 32
```

Every deploy:

```bash
npm run build
npx wrangler d1 migrations apply hiyield-uptime-staging --remote --env staging
npx wrangler deploy --env staging
```

After the first deploy:
1. Sign in, add contacts (Slack webhook per channel, emails), mark the main channel as Default.
2. Bulk-add client sites at `/monitors/bulk`.
3. Point an external pinger (healthchecks.io or UptimeRobot free) at `https://<host>/health`, alerting the dev team. This is what tells you if the monitor itself dies.

Custom domain: not set yet. When decided, add a `routes` entry with `custom_domain: true` to the env in `wrangler.jsonc`, update `PUBLIC_BASE_URL` / `BETTER_AUTH_URL`, and add the new Google redirect URI.

## Adding an alert channel (e.g. SMS)

1. Add the type to the `contacts.type` check constraint (new migration) and `schema.ts`.
2. Add `server/engine/notify/<channel>.ts` with a payload builder + `deliver…()`.
3. Add a branch in `createSender` (`server/engine/notify/index.ts`) and a variant in `contactCreateSchema`.
````

- [ ] **Step 2: Final verification**

Run:
```bash
npm run lint && npm run typecheck && npm run test:all && npm run build && npx wrangler deploy --env staging --dry-run --outdir /tmp/uptime-staging-dry
```
Expected: everything passes.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: README with local dev, deploy runbook and channel extension guide"
```

- [ ] **Step 4: Staging deploy — STOP and ask the user first**

Deploying creates real Cloudflare resources and needs secrets only the user has (Google OAuth client, Resend key). Do not run these without explicit approval. Ask the user to confirm, then follow the README's "Deploy" section for `staging`, then:
1. Open the staging URL, sign in with a `@hiyield.co.uk` account.
2. Add a monitor for a known-good site and confirm it turns Up within a minute.
3. `curl https://<staging host>/health` → 200.
4. Report the URL and anything that differed from the README back to the user.
