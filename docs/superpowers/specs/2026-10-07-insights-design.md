# Hiyield Uptime — Insights & Board Charts Design Spec

**Date:** 2026-10-07
**Status:** Approved in brainstorming, pending written-spec review
**Branch:** `feat/insights` (off `main` @ 6b04275)
**Builds on:** `docs/superpowers/specs/2026-10-06-uptime-monitor-design.md`

## 1. Purpose

The status board is a single table: it shows what is down *now* but not how the fleet is doing or trending. Staff want at-a-glance health on the wall board and a place to look back at reliability and performance over time.

**Success criteria**

- The board answers "how are we doing overall?" and "which sites have been flaky today?" without clicking into each site.
- A new Insights page answers "how reliable were our sites over the last week/month/year?" and "which sites need attention?"
- Chart data is cheap to read: the board stays on a 15s refresh without the per-refresh D1 read volume growing materially; Insights loads in well under a second for 100 sites × 1 year.
- History is available beyond the 90-day raw-check retention.

## 2. Scope

**In**

- Write-time rollup tables (30-minute and daily) maintained by MonitorDO, with retention and a one-off backfill.
- Board: five overview tiles with sparklines; per-row 24h uptime bar and 24h response sparkline.
- Insights page (`/insights`): range picker (7d/30d/90d/1y), headline tiles, downtime-per-day and incidents-per-day charts, "Most downtime" and "Slowest response" rankings, table views.

**Out**

- True percentile (p95) response times — rollups store average and max only; labels say "average (worst)".
- Changing the site detail page (it keeps reading raw checks).
- Per-site Insights filters, exports, or scheduled reports.
- Local-timezone day boundaries (days are UTC — see §3).

## 3. Data model

New migration `0003_rollups.sql`:

| Table | Primary key | Columns (all integer) |
|---|---|---|
| `rollup_30m` | (`monitor_id`, `bucket_start`) | `checks`, `failures`, `blips`, `maintenance`, `resp_sum`, `resp_count`, `resp_max` |
| `rollup_daily` | (`monitor_id`, `day_start`) | same columns |

- `monitor_id` references `monitors(id)` `on delete cascade`.
- `bucket_start` = check time floored to 30 minutes (epoch ms, UTC). `day_start` = floored to the UTC day.
- Only **primary** checks are counted (probe rows are not).
- `checks` counts every primary check. `maintenance` counts primary checks taken during a maintenance window. `failures` counts primary checks with `ok = false AND confirmed = true AND maintenance = false`. `blips` counts primary checks with `ok = false AND confirmed = false AND maintenance = false`.
- `resp_sum`/`resp_count`/`resp_max` aggregate non-null `response_ms` of primary checks. Average = `resp_sum / resp_count`.
- Index: `rollup_30m (bucket_start)` and `rollup_daily (day_start)` for range scans across all monitors.

**Day boundaries are UTC.** In British Summer Time a "day" runs 01:00–01:00 local. Accepted for simplicity.

**Downtime is not stored in rollups.** It is computed from `incidents` (`started_at` → `resolved_at`, or `now` if open), clipped and split across the days/range it overlaps.

## 4. Engine changes

- Pure function `rollupDelta(check: CheckResult, opts: { confirmed: boolean; maintenance: boolean }): RollupDelta` returning `{ checks: 1, failures, blips, maintenance, respSum, respCount, respMax }` (0/1 counters; resp fields 0/null when no response time).
- Pure helpers `bucket30m(ms)` and `dayStart(ms)`.
- `repo.upsertRollups(db, monitorId, checkedAt, delta)` runs two `INSERT … ON CONFLICT (monitor_id, bucket_start|day_start) DO UPDATE SET checks = checks + excluded.checks, …, resp_max = max(resp_max, excluded.resp_max)` statements.
- `MonitorDO.runTick` calls it once per tick for the primary check, after inserting check rows, wrapped in `safe()`, and only if the tick is still current (same abort guard as other writes). A rollup failure never affects monitoring.

## 5. Retention and backfill

- Daily prune cron additionally deletes `rollup_30m` rows with `bucket_start` older than 8 days and `rollup_daily` rows with `day_start` older than 400 days.
- `POST /api/cron/backfill-rollups` (requires `x-admin-secret`): for the range covered by raw checks, deletes rollup rows in that range and rebuilds both tables with `INSERT … SELECT … GROUP BY` from primary `checks`. Idempotent. Rows for days older than raw retention are left untouched. README documents running it once after deploying this feature.

## 6. Board

### 6.1 Overview tiles

Five tiles above the table:

| Tile | Value | Sparkline |
|---|---|---|
| Down now | count of monitors with status `down`; red with alert icon when > 0, neutral at 0 | none |
| Uptime 24h | fleet uptime % over last 24h | 48 half-hour fleet uptime values |
| Uptime 30d | fleet uptime % over last 30 days | 30 daily values |
| Incidents 7d | incidents started in last 7 days, with delta vs previous 7 days (▲/▼ n) | 14 daily counts, as bars |
| Avg response 24h | fleet average response ms over last 24h | 48 half-hour averages |

- Fleet uptime % = `1 − Σfailures / Σ(checks − maintenance)` over the window, 2 dp; null (shown "—") when there are no counted checks.
- Values in the heading font, white; sparklines thin electric lines, no axes; hover shows the point's value and time.

### 6.2 Table columns

- **Last 24h** — 48 blocks, one per half-hour ending at the current bucket. Block state precedence: red (`failures > 0`), amber (`blips > 0`), blue (`maintenance > 0` and no failures/blips), green (`checks > 0`), grey (no data). Secondary encoding by height: green 50%, amber 75%, red 100%, blue 50%, grey 25%. Hover tooltip: time range, state label, checks, failures, average response.
- **Response 24h** — replaces the existing single-value Response column: 48-point sparkline of half-hour average response (gaps where no data) with the latest value printed beside it; hover shows point value and time.
- Existing Status, Site, Last check, 24h uptime, Down for columns stay.

### 6.3 API

`GET /api/monitors` adds:
- `summary: { downNow, uptime24h, uptime30d, incidents7d, incidentsPrev7d, avgResponse24h, series: { uptime24h: (number|null)[48], uptime30d: (number|null)[30], incidents14d: number[14], response24h: (number|null)[48] } }`
- per row: `bars: ('down'|'blip'|'maintenance'|'up'|'none')[48]` with `barStats` per block for tooltips (`{ checks, failures, avgMs }`), and `spark: (number|null)[48]`.

Reads: `rollup_30m` for the last 24h (≈ 48 rows per monitor), `rollup_daily` for 30 days, incidents started in the last 14 days. Bucket alignment is computed server-side from `now` so the client renders arrays as-is.

### 6.4 Colours (dark surface `#001313`)

| State | Colour |
|---|---|
| up | electric-500 |
| blip | amber-400 |
| down | red-500 |
| maintenance | sky-500 |
| none | dark ink (≈ #1f2b2b) |

Validated with the dataviz skill's `validate_palette.js --mode dark` against `#001313`; shades adjusted if any check fails. Height encoding means state is never conveyed by colour alone.

## 7. Insights page

- Route `/insights`, nav item after Status.
- **Range picker** (segmented control, one row above all charts): `7d · 30d · 90d · 1y`; default 30d; persisted in the URL query (`?range=`).
- **Headline tiles** for the range: fleet uptime %, incidents, total downtime (formatted duration), average time to recovery (mean duration of incidents resolved in the range; "—" if none).
- **Downtime per day** — bar chart, one bar per UTC day in range, height = downtime minutes, red-500. Hover: date, downtime, incidents, sites affected (names).
- **Incidents per day** — smaller bar chart directly beneath, same x-axis/dates, neutral/ink bars. No dual axes anywhere.
- **Most downtime** (top 10) — site name (link to `/monitors/:id`), horizontal bar for downtime, incidents count, uptime % in range.
- **Slowest response** (top 10) — site name (link), horizontal bar for average response, marker for worst (max) response; header "Average (worst) response".
- Each chart/list has a "View as table" toggle rendering the same data as a table.
- Empty state when no rollup data exists in range: "No history yet — data appears as checks run. To include past checks, run the rollup backfill (see README)."
- For 1y, daily bars are aggregated to weekly bars (≈ 52) to keep marks legible; tooltip shows the week range.

### 7.1 API

`GET /api/insights?range=7d|30d|90d|1y` (default 30d; invalid → 400):

```
{
  range, from, to,
  tiles: { uptime, incidents, downtimeMs, mttrMs },
  days: [{ start, end, downtimeMs, incidents, sites: [{ id, name }] }],   // days, or weeks for 1y
  worst: [{ id, name, downtimeMs, incidents, uptime }],                  // top 10 by downtimeMs, >0 only
  slowest: [{ id, name, avgMs, maxMs }]                                  // top 10 by avgMs, monitors with resp data only
}
```

Reads `rollup_daily` in range and incidents overlapping the range. Deleted monitors don't appear (cascade).

## 8. Error handling

- Rollup writes in the DO are best-effort (`safe()`); monitoring never depends on them.
- Insights/board endpoints degrade to nulls/empty arrays when rollups are missing, never 500 for "no data".
- Range validation via `validateBody`-style query validation (400 with message).
- Charts render an explicit empty state rather than an empty axis.

## 9. Testing

**Unit (in-memory SQLite from real migrations)**
- `rollupDelta`: up, confirmed failure, blip, maintenance (failure during maintenance counts only as maintenance), no response time.
- `bucket30m` / `dayStart` boundaries.
- `upsertRollups`: two checks in the same bucket accumulate; `resp_max` keeps the maximum; different buckets/days produce separate rows.
- Incident day-splitting: incident within one day, spanning midnight, spanning the range start/end, still open.
- Board summary: fleet uptime with maintenance excluded, empty buckets → null, 48-bucket alignment, block state precedence, incidents 7d vs previous 7d.
- Insights aggregation: tiles, MTTR, worst/slowest ordering and top-10 cut, weekly aggregation for 1y.
- Backfill: rebuilt rollups equal those produced by `upsertRollups` for the same checks; idempotent on re-run.
- Prune: old rollup rows removed, recent kept.

**Integration (workerd)**
- A MonitorDO tick writes one `rollup_30m` and one `rollup_daily` row with correct counters; a blip tick increments `blips`; a maintenance tick increments `maintenance` only; an aborted (paused mid-tick) tick writes no rollup.

**UI** — typecheck + build; render check of `/insights` and the board in Chrome where possible; final visual check by the user.
