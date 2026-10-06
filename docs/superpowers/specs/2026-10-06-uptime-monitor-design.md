# Hiyield Uptime — Design Spec

**Date:** 2026-10-06
**Status:** Approved in brainstorming, pending written-spec review
**Repo:** `hiyield-uptime`

## 1. Purpose

Hiyield staff need to know quickly when a client website goes down. Hiyield manages ~100 client sites; a subset of them will be monitored. This is an internal tool — clients have no access.

**Success criteria**

- Staff are alerted within a few minutes of a monitored site going down.
- False alarms are rare (single network blips do not page anyone).
- Everything — which sites, how often, who is alerted, how cautious alerting is — is configurable from the dashboard without a redeploy.
- If the monitor itself stops working, someone finds out.

## 2. Scope

**In v1**

- HTTP(S) monitoring of client sites with per-site check intervals (30s to 30m).
- Two-region confirmation of failures.
- Alerts to Slack channels (incoming webhooks) and email (Resend).
- Per-site alert routing via a shared contact list.
- Per-site alert sensitivity (fail threshold, reminder interval).
- Maintenance windows (per site or all sites).
- Dashboard: status board, site detail with history, monitor CRUD, contacts, maintenance.
- Bulk add of sites; "Launch watch" preset for newly launched sites.
- Self-monitoring via a `/health` endpoint watched by an external pinger.

**Out of v1 (explicitly deferred)**

- SMS / phone alerts (the notifier interface must make this a single new module).
- Client logins, public status pages, monthly client uptime reports.
- User roles — every signed-in user is an admin.
- Keyword checks, SSL expiry checks, non-HTTP checks.
- Hourly/daily rollup tables.
- Custom domain (decided at deploy time).

## 3. Stack

Matches the existing Hiyield `qa` app so the team already knows it:

- Nuxt 4 + Nuxt UI 4, deployed as a Cloudflare Worker.
- Cloudflare D1 + Drizzle ORM (migrations via wrangler).
- Cloudflare Durable Objects for scheduling and per-site state.
- Better Auth with Google OAuth, restricted to `@hiyield.co.uk` accounts.
- Resend for email.
- Vitest with `unit` and `integration` projects; `@cloudflare/vitest-pool-workers` for integration tests.
- `wrangler.jsonc` with `staging` and `production` environments.

## 4. Architecture

```
┌─────────────── Cloudflare Worker: "hiyield-uptime" ─────────┐
│ Nuxt 4 app (Nuxt UI) ── dashboard + /api/*  (Better Auth)   │
│      │ config changes                                       │
│      ▼                                                      │
│ MonitorDO  ×1 per site ── alarm loop, state, alerts         │
│      │ "confirm?"                       │ results           │
│      ▼                                  ▼                   │
│ ProbeDO ×1 (locationHint: enam) ── single fetch, stateless  │
│                                         D1 (config+history) │
│ Notifier ── Slack webhook | Resend email | (SMS later)      │
│ Daily cron ── prune old checks                              │
└─────────────────────────────────────────────────────────────┘
```

### Units

| Unit | Responsibility | Depends on |
|---|---|---|
| `evaluate()` (pure) | Given current state, primary check result, optional probe result, monitor config, active maintenance flag and `now`, returns `{ nextState, actions[], nextCheckAt }`. All alerting decisions live here. | nothing |
| `runCheck()` (pure, injected fetch) | Performs one HTTP check and classifies it as up/down with status code, response time and error. | a `fetch` function |
| `MonitorDO` | One per monitored site, keyed by monitor id. Loads config from D1, runs `runCheck`, calls ProbeDO when needed, calls `evaluate`, executes actions (write check, open/resolve incident, send alerts), schedules next alarm. Exposes `reload()`, `checkNow()`, `stop()`. | D1, ProbeDO, Notifier |
| `ProbeDO` | Single instance created with `locationHint: "enam"`. Exposes `probe(url, opts)` which calls `runCheck` and returns the result. Stores nothing. | `runCheck` |
| Notifier | `send(contact, message)` dispatches to a channel module. Each channel module: `format(event)` + `deliver(target, payload)`. v1 channels: `slack`, `email`. Retries up to 3× with backoff; every attempt recorded in `alert_deliveries`. | Resend, `fetch` |
| API routes (`/api/*`) | CRUD for monitors, contacts, maintenance windows; bulk add; test URL; check now; health. After any monitor config write, calls the site's `MonitorDO.reload()` (or `stop()` on pause/delete). | D1, MonitorDO, Better Auth |
| Dashboard pages | Section 7. | API routes |
| Daily cron | Deletes `checks` rows older than 90 days. | D1 |

MonitorDO placement is left to Cloudflare's default (near where it is first created — the UK in practice). ProbeDO is hinted to eastern North America so confirmation comes from a separate network location.

## 5. Data model (D1)

| Table | Fields |
|---|---|
| `monitors` | `id`, `name`, `url`, `interval_s` (30, 60, 120, 300, 600, 900, 1800; default 300), `timeout_ms` (default 10000), `fail_threshold` (default 2, min 1), `reminder_mins` (0 = off, 15, 30, 60; default 30), `paused` (bool), `status` (`up` \| `suspect` \| `down` \| `paused` \| `unknown`), `consecutive_failures`, `last_checked_at`, `last_response_ms`, `last_status_code`, `created_at`, `updated_at` |
| `contacts` | `id`, `name`, `type` (`slack` \| `email`), `target` (webhook URL or email address), `is_default` (bool), `created_at` |
| `monitor_contacts` | `monitor_id`, `contact_id` (composite PK) |
| `checks` | `id`, `monitor_id`, `checked_at`, `ok` (bool), `status_code` (nullable), `response_ms` (nullable), `error` (nullable), `region` (`primary` \| `probe`), `confirmed` (bool — whether a failure was confirmed by the probe), `maintenance` (bool). Index on `(monitor_id, checked_at)`. |
| `incidents` | `id`, `monitor_id`, `started_at` (first confirmed failure), `confirmed_at` (when threshold reached and alert sent), `resolved_at` (nullable), `cause`, `last_reminder_at` |
| `maintenance_windows` | `id`, `monitor_id` (nullable = all sites), `starts_at`, `ends_at`, `note`, `created_by` |
| `alert_deliveries` | `id`, `incident_id`, `contact_id`, `kind` (`down` \| `reminder` \| `recovered` \| `test`), `attempt`, `ok`, `error`, `sent_at` |
| Better Auth tables | users, sessions, accounts, verification |

Slack webhook URLs are stored in D1 and masked in the UI (only the last 6 characters shown after save).

**Retention:** raw `checks` kept 90 days. At ~100 sites on 5-minute intervals this is ~2.6M rows; uptime percentages are computed from raw rows using the `(monitor_id, checked_at)` index.

## 6. Check and alert behaviour

### Down definition

A check is **down** if any of: HTTP status ≥ 400, timeout (`timeout_ms`), DNS failure, TLS failure, connection error. Redirects are followed; the final response's status is used. 2xx and 3xx are **up**. Method is `GET`.

### State machine

```
        ok                 confirmed fail              fails ≥ threshold
  ┌──► UP ──────────────► SUSPECT ──────────────────► DOWN ──┐
  │     ▲                   │ ok                        │    │ still failing:
  │     └───────────────────┘                           │    │ reminder every
  │                    ok → "Recovered" alert           │    │ reminder_mins
  └─────────────────────────────────────────────────────┘◄───┘
  PAUSED: no alarm, no checks.   MAINTENANCE: checks run, no alerts.
```

`unknown` is the initial state before the first check; it behaves like `up`.

### Per-tick algorithm (MonitorDO alarm)

1. Run `runCheck` from the primary location.
2. If down, immediately call `ProbeDO.probe()`.
   - Probe up → **blip**: record the failed check with `confirmed = false`; do not increment `consecutive_failures`.
   - Probe down → **confirmed failure**: increment `consecutive_failures`.
3. Pass results to `evaluate()`; execute returned actions.
4. Transitions:
   - UP/UNKNOWN + confirmed failure, count < threshold → SUSPECT; next check in 30s (regardless of `interval_s`).
   - UP/UNKNOWN/SUSPECT + confirmed failure, count ≥ threshold → DOWN; open incident (`started_at` = first confirmed failure time); send `down` alert to the monitor's contacts. With `fail_threshold = 1` this happens on the first confirmed failure.
   - SUSPECT + up → UP; reset count; resume normal interval. No alert.
   - DOWN + failure → stay DOWN; if `reminder_mins > 0` and `now − last_reminder_at ≥ reminder_mins` (falling back to `confirmed_at`), send `reminder`.
   - DOWN + up → UP; resolve incident; send `recovered` alert including downtime duration.
   - Blips leave the state unchanged, except a SUSPECT monitor keeps the 30s retry cadence.
5. Write `last_checked_at`, `status`, and latest metrics to `monitors`.
6. Schedule the next alarm in a `finally` block so an exception never stops a monitor. (Cloudflare also retries alarms that throw.)

### Maintenance windows

While a window covering the monitor is active: checks run and are recorded with `maintenance = true`; no incidents are opened and no alerts are sent; these checks are excluded from uptime percentages. When the window ends, the next tick evaluates normally — if the site is still down, it proceeds through SUSPECT/DOWN as usual from a zero count.

### Alerts

- **Content:** site name, URL, error (e.g. `HTTP 503`, `timeout after 10s`), time since first failure, link to the site's dashboard page. Recovered alerts include total downtime.
- **Recipients:** the monitor's linked contacts. New monitors are pre-linked to all `is_default` contacts.
- **Delivery:** each contact is sent independently; failures for one contact do not block others. Up to 3 attempts with backoff; every attempt recorded in `alert_deliveries`.
- **Slack:** incoming webhook POST with a Block Kit message (red for down/reminder, green for recovered).
- **Email:** Resend, plain HTML template.

### Config changes

API writes to D1, then calls `MonitorDO.reload()`, which re-reads config and reschedules the alarm (next check at `min(existing next alarm, now + new interval)`). Pause/delete calls `stop()`, which deletes the alarm and sets status to `paused`. Unpause calls `reload()` and checks immediately.

### Self-monitoring

`GET /health` (unauthenticated) returns 200 if every non-paused monitor has `last_checked_at` within `2 × interval_s` (minimum 2 minutes), else 500 with the list of stale monitor ids. An external free pinger (healthchecks.io or UptimeRobot free tier) polls `/health` and alerts the team if it fails. Configured manually after deploy.

## 7. Dashboard

All pages require a Better Auth session from a Google account with an `@hiyield.co.uk` email. Non-Hiyield emails are rejected at sign-in.

| Page | Contents |
|---|---|
| `/` Status board | Table of monitors, down first. Columns: status pill (Up / Suspect / Down / Paused / Maintenance — "Maintenance" is derived from an active window, not stored in `monitors.status`; `unknown` shows as "Pending"), name, URL, last check, response ms, 24h uptime %, down duration (if down). Filter by status, search by name. Header counts ("2 down · 87 up · 4 paused"). Polls every 15s. |
| `/monitors/:id` | Uptime % for 24h / 7d / 30d; response-time chart (24h / 7d); incident log (start, end, duration, cause); last 50 checks with region; alert deliveries including failures; maintenance windows for this site; buttons: Check now, Pause/Resume, Edit. |
| `/monitors/new`, `/monitors/:id/edit` | Name, URL, interval, timeout, fail threshold, reminder, contact checkboxes (defaults pre-ticked), paused toggle. **Test URL** button runs a single check without saving. **Launch watch** preset sets interval 60s and fail threshold 1. |
| `/monitors/bulk` | Textarea of `name, url` lines; preview parsed rows with validation errors; create all with default settings and default contacts. |
| `/contacts` | List/add/edit/delete Slack (name + webhook URL) and email contacts; default toggle; **Send test alert**; shows which monitors use each contact. |
| `/maintenance` | Upcoming and past windows; create for one site or all sites (start, end, note); delete upcoming. |

## 8. Error handling

- `runCheck` never throws; all network errors become a down result with an `error` string.
- MonitorDO wraps each tick in try/finally; the next alarm is always scheduled.
- Notifier failures are recorded and surfaced on the site detail page; they never affect monitor state.
- D1 write failures inside a tick are logged; the tick's in-memory state still advances and the alarm is still scheduled.
- API validation: URLs must be `http(s)://`; interval/reminder must be from the allowed sets; `fail_threshold` 1–10; `timeout_ms` 1000–30000.

## 9. Testing

**Unit (vitest `unit` project)**

- `evaluate()`: every transition in Section 6 — blip vs confirmed failure; thresholds 1, 2 and 3; SUSPECT 30s retry cadence; reminder timing and reminder-off; recovery with duration; maintenance start/end mid-incident; paused.
- `runCheck()`: 2xx, 3xx-followed-to-2xx, 3xx-followed-to-4xx, 4xx, 5xx, timeout, DNS error, TLS error.
- Notifier formatting for Slack and email for each event kind.
- Bulk-add parser.

**Integration (vitest `integration` project, `@cloudflare/vitest-pool-workers`)**

- MonitorDO alarm against a fake target: check row written → incident opened → notifier called → recovery resolves incident.
- `reload()` applies a new interval; `stop()` cancels the alarm.
- `/health` returns 500 when a monitor is stale.
- Auth: unauthenticated API request → 401; non-`@hiyield.co.uk` sign-in rejected.

## 10. Deployment

- `wrangler.jsonc` with `staging` and `production` envs; D1 database per env; DO bindings `MONITOR` and `PROBE` with migrations; daily cron trigger.
- Secrets: `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`.
- Domain: decided at deploy time.
- Post-deploy: configure external pinger on `/health`; add initial contacts; bulk-add client sites.
