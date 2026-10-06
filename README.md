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

**Node 24 is required.** Run `nvm use` in this directory.

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
npm run test:all          # both
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
4. Confirm the two cron triggers registered (Cloudflare dashboard → Worker → Settings → Triggers); `wrangler --dry-run` doesn't print them.

**D1 plan and the status board.** The board (`/`) polls `GET /api/monitors` every 15 seconds, and each refresh scans the last 24 hours of `checks` to compute uptime — roughly 30k rows read per refresh with a typical client list (more sites or shorter intervals read more). One board left open reads ~100M+ rows/day, far past the D1 free plan's 5M rows/day. Run this on paid D1 (Workers Paid), or raise the poll interval in `app/pages/index.vue` if you must stay on the free plan.

Custom domain: not set yet. When decided, add a `routes` entry with `custom_domain: true` to the env in `wrangler.jsonc`, update `PUBLIC_BASE_URL` / `BETTER_AUTH_URL`, and add the new Google redirect URI.

## Dependency pins

- `nuxt` (4.4.6) and `@nuxt/ui` (4.8.0) are pinned exactly because newer versions broke `nuxt typecheck` with this config; revisit when you're confident the type issues are resolved.
- `package.json` `overrides` pin `miniflare` and `workerd` to wrangler's versions to ensure the Workers test pool (@cloudflare/vitest-pool-workers) supports compatibility date 2026-08-25. Revisit both when bumping wrangler or vitest-pool-workers.

## Adding an alert channel (e.g. SMS)

1. Add the type to the `contacts.type` check constraint (new migration) and `schema.ts`.
2. Add `server/engine/notify/<channel>.ts` with a payload builder + `deliver…()`.
3. Add a branch in `createSender` (`server/engine/notify/index.ts`) and a variant in `contactCreateSchema`.
