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
