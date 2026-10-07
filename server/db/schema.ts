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
