-- Write-time rollups of primary checks. Maintained by MonitorDO; rebuilt by /api/cron/backfill-rollups.
create table rollup_30m (
  monitor_id text not null references monitors (id) on delete cascade,
  bucket_start integer not null,
  checks integer not null default 0,
  failures integer not null default 0,
  blips integer not null default 0,
  maintenance integer not null default 0,
  resp_sum integer not null default 0,
  resp_count integer not null default 0,
  resp_max integer not null default 0,
  primary key (monitor_id, bucket_start)
);
create index rollup_30m_bucket on rollup_30m (bucket_start);

create table rollup_daily (
  monitor_id text not null references monitors (id) on delete cascade,
  day_start integer not null,
  checks integer not null default 0,
  failures integer not null default 0,
  blips integer not null default 0,
  maintenance integer not null default 0,
  resp_sum integer not null default 0,
  resp_count integer not null default 0,
  resp_max integer not null default 0,
  primary key (monitor_id, day_start)
);
create index rollup_daily_day on rollup_daily (day_start);

-- The board's incidents-per-day query filters by started_at only (not monitor_id, to avoid D1's
-- 100-bound-parameter limit on large fleets); the existing (monitor_id, started_at) composite
-- index can't serve that filter efficiently since started_at isn't its leading column.
create index incidents_started on incidents (started_at);
