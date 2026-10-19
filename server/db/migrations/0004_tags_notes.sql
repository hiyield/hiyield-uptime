-- Free-form tags per monitor (normalised lowercase, see shared/utils/validation.ts normaliseTag).
create table monitor_tags (
  monitor_id text not null references monitors (id) on delete cascade,
  tag text not null,
  primary key (monitor_id, tag)
);
create index monitor_tags_tag on monitor_tags (tag);

-- Human-written incident notes (cause, fix, ticket). Who last edited and when.
alter table incidents add column note text not null default '';
alter table incidents add column note_by text;
alter table incidents add column note_at integer;
