/**
 * Drizzle SQLite schema for the Control-iD Facial Emulator.
 *
 * This module is the single source of truth for the emulator's database table
 * definitions. It contains ONLY table definitions and inferred types — no
 * driver wiring, no connection logic (that lives in `connection.ts`).
 *
 * Timestamps: the interception log stores ISO 8601 UTC strings with millisecond
 * precision; other time fields mirror the device's Unix-epoch string/number
 * conventions for fidelity with the Official Control-iD API.
 *
 * See design.md → "Data Models".
 */
import { sqliteTable, integer, text, primaryKey } from 'drizzle-orm/sqlite-core';

// Configuration stored per module as a JSON blob keyed by module name.
export const config = sqliteTable('config', {
  module: text('module').primaryKey(), // e.g. 'monitor'
  json: text('json').notNull(), // serialized Record<string, unknown>
  updatedAt: text('updated_at').notNull(), // ISO 8601 UTC
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  registration: text('registration').notNull(),
  name: text('name').notNull(),
  password: text('password'),
  imagePath: text('image_path'), // optional stored face image
});

export const accessLogs = sqliteTable('access_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  time: text('time').notNull(), // Unix epoch seconds (string, device shape)
  event: text('event').notNull(), // '7' granted, '6' denied, '3' not identified
  deviceId: text('device_id').notNull(),
  identifierId: text('identifier_id').notNull().default('0'),
  userId: text('user_id').notNull().default('0'),
  portalId: text('portal_id').notNull().default('1'),
  identificationRuleId: text('identification_rule_id').notNull().default('0'),
  cardValue: text('card_value').notNull().default('0'),
  logTypeId: text('log_type_id').notNull().default('-1'),
});

export const changeLogs = sqliteTable('change_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  operationType: text('operation_type').notNull(),
  tableName: text('table_name').notNull(),
  tableId: text('table_id').notNull(),
  timestamp: text('timestamp').notNull(),
});

export const templates = sqliteTable('templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fingerPosition: text('finger_position'), // reserved field
  fingerType: text('finger_type').notNull(), // 0 common finger, 1 panic finger
  template: text('template'), // base64 biometric template payload
  userId: text('user_id').notNull(),
});

export const cards = sqliteTable('cards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  value: text('value').notNull(),
  userId: text('user_id').notNull(),
});

export const qrcodes = sqliteTable('qrcodes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  value: text('value').notNull(),
  userId: text('user_id').notNull(),
});

export const uhfTags = sqliteTable('uhf_tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  value: text('value').notNull(),
  userId: text('user_id').notNull(),
});

export const pins = sqliteTable('pins', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  value: text('value').notNull(),
  userId: text('user_id').notNull(),
});

// `zone` (not `id`) is the device-assigned primary key for this object, per
// docs/route-gaps-field-reference.md.
export const alarmZones = sqliteTable('alarm_zones', {
  zone: integer('zone').primaryKey(),
  enabled: text('enabled').notNull(),
  activeLevel: text('active_level').notNull(),
  alarmDelay: text('alarm_delay').notNull(),
});

// `user_id` (not `id`) is the device-assigned primary key for this object,
// per docs/route-gaps-field-reference.md — one role row per user.
export const userRoles = sqliteTable('user_roles', {
  userId: integer('user_id').primaryKey(),
  role: text('role').notNull(),
});

export const scheduledUnlocks = sqliteTable('scheduled_unlocks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  message: text('message'),
});

// `group_id` (not `id`) is the device-assigned primary key for this object,
// per docs/route-gaps-field-reference.md.
export const actions = sqliteTable('actions', {
  groupId: integer('group_id').primaryKey(),
  name: text('name').notNull(),
  action: text('action').notNull(),
  parameters: text('parameters').notNull(),
  runAt: text('run_at').notNull(), // 0 device, 1 all devices, 2 server
});

export const areas = sqliteTable('areas', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
});

export const timeSpans = sqliteTable('time_spans', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timeZoneId: text('time_zone_id').notNull(),
  start: text('start').notNull(),
  end: text('end').notNull(),
  sun: text('sun').notNull(),
  mon: text('mon').notNull(),
  tue: text('tue').notNull(),
  wed: text('wed').notNull(),
  thu: text('thu').notNull(),
  fri: text('fri').notNull(),
  sat: text('sat').notNull(),
  hol1: text('hol1').notNull(),
  hol2: text('hol2').notNull(),
  hol3: text('hol3').notNull(),
});

export const contingencyCards = sqliteTable('contingency_cards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  value: text('value').notNull(),
});

export const holidays = sqliteTable('holidays', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  start: text('start').notNull(),
  end: text('end').notNull(),
  hol1: text('hol1').notNull(),
  hol2: text('hol2').notNull(),
  hol3: text('hol3').notNull(),
  repeats: text('repeats').notNull(),
});

export const sessions = sqliteTable('sessions', {
  token: text('token').primaryKey(),
  issuedAt: integer('issued_at').notNull(), // epoch ms
  expiresAt: integer('expires_at').notNull(), // issuedAt + 3600_000
});

export const interceptionLog = sqliteTable('interception_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  direction: text('direction').notNull(), // 'inbound' | 'outbound'
  method: text('method').notNull(),
  path: text('path').notNull(), // inbound path or outbound target URL
  timestamp: text('timestamp').notNull(), // ISO 8601 UTC, ms precision
  body: text('body').notNull(),
  truncated: integer('truncated', { mode: 'boolean' }).notNull().default(false), // Req 8.2 (> 64 KB)
  outcome: text('outcome'), // 'success' | 'failure' | 'no_target'
  statusCode: integer('status_code'),
  attempts: integer('attempts'),
  failureCategory: text('failure_category'),
});

// ---------------------------------------------------------------------------
// Admin Management Panel additions (strictly additive; existing tables above
// are left untouched — Req 1.5). New tables model Groups, Portals, Time Zones
// (with Time Ranges), and Access Rules and their associations.
//
// Foreign keys are enforced at the DB level (connection.ts sets
// `PRAGMA foreign_keys = ON`). Owned children (`users_groups`, `time_ranges`,
// and the `access_rule_*` rows toward the owning Access Rule) use ON DELETE
// CASCADE. Join columns pointing at Groups/Time Zones/Portals use ON DELETE
// RESTRICT as a defense-in-depth backstop; the authoritative referential-
// integrity check (409) runs in the service layer (Req 7.7).
//
// See design.md → "Data Models → Drizzle schema additions".
// ---------------------------------------------------------------------------

// --- Groups (Control-iD `groups`) ---
export const groups = sqliteTable('groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
});

// User↔Group membership: many-to-many (Req 1.2). Composite PK prevents dup rows.
export const usersGroups = sqliteTable(
  'users_groups',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.groupId] }) }),
);

// --- Portals (Control-iD `portals`; doors) ---
export const portals = sqliteTable('portals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
});

// --- Time Zones (Control-iD `time_zones`; horários) ---
export const timeZones = sqliteTable('time_zones', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
});

// A Time Range belongs to exactly one Time Zone (owned child; cascade on delete).
// `days` is a 7-bit mask (bit 0 = Sunday … bit 6 = Saturday); start/end are 'HH:MM'.
export const timeRanges = sqliteTable('time_ranges', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timeZoneId: integer('time_zone_id')
    .notNull()
    .references(() => timeZones.id, { onDelete: 'cascade' }),
  days: integer('days').notNull(), // 7-bit weekday mask, 1..127
  startTime: text('start_time').notNull(), // 'HH:MM' 24-hour
  endTime: text('end_time').notNull(), // 'HH:MM' 24-hour, strictly after startTime
});

// --- Access Rules (Control-iD `access_rules`) ---
export const accessRules = sqliteTable('access_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
});

// Access Rule associations: three many-to-many join tables (Req 1.3, 7).
export const accessRuleGroups = sqliteTable(
  'access_rule_groups',
  {
    accessRuleId: integer('access_rule_id')
      .notNull()
      .references(() => accessRules.id, { onDelete: 'cascade' }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'restrict' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.accessRuleId, t.groupId] }) }),
);

export const accessRuleTimeZones = sqliteTable(
  'access_rule_time_zones',
  {
    accessRuleId: integer('access_rule_id')
      .notNull()
      .references(() => accessRules.id, { onDelete: 'cascade' }),
    timeZoneId: integer('time_zone_id')
      .notNull()
      .references(() => timeZones.id, { onDelete: 'restrict' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.accessRuleId, t.timeZoneId] }) }),
);

export const accessRulePortals = sqliteTable(
  'access_rule_portals',
  {
    accessRuleId: integer('access_rule_id')
      .notNull()
      .references(() => accessRules.id, { onDelete: 'cascade' }),
    portalId: integer('portal_id')
      .notNull()
      .references(() => portals.id, { onDelete: 'restrict' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.accessRuleId, t.portalId] }) }),
);

/**
 * The full schema object, convenient for `drizzle(client, { schema })` and for
 * `db.query.*` typed access.
 */
export const schema = {
  config,
  users,
  accessLogs,
  sessions,
  interceptionLog,
  // Admin Management Panel additions.
  groups,
  usersGroups,
  portals,
  timeZones,
  timeRanges,
  accessRules,
  accessRuleGroups,
  accessRuleTimeZones,
  accessRulePortals,
};

// --- Inferred row types (source of truth for DB record shapes) ---

export type ConfigRow = typeof config.$inferSelect;
export type ConfigInsert = typeof config.$inferInsert;

export type UserRow = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;

export type AccessLogRow = typeof accessLogs.$inferSelect;
export type AccessLogInsert = typeof accessLogs.$inferInsert;

export type SessionRow = typeof sessions.$inferSelect;
export type SessionInsert = typeof sessions.$inferInsert;

export type InterceptionLogRow = typeof interceptionLog.$inferSelect;
export type InterceptionLogInsert = typeof interceptionLog.$inferInsert;

// --- Admin Management Panel inferred row/insert types ---

export type GroupRow = typeof groups.$inferSelect;
export type GroupInsert = typeof groups.$inferInsert;

export type UsersGroupsRow = typeof usersGroups.$inferSelect;
export type UsersGroupsInsert = typeof usersGroups.$inferInsert;

export type PortalRow = typeof portals.$inferSelect;
export type PortalInsert = typeof portals.$inferInsert;

export type TimeZoneRow = typeof timeZones.$inferSelect;
export type TimeZoneInsert = typeof timeZones.$inferInsert;

export type TimeRangeRow = typeof timeRanges.$inferSelect;
export type TimeRangeInsert = typeof timeRanges.$inferInsert;

export type AccessRuleRow = typeof accessRules.$inferSelect;
export type AccessRuleInsert = typeof accessRules.$inferInsert;

export type AccessRuleGroupRow = typeof accessRuleGroups.$inferSelect;
export type AccessRuleGroupInsert = typeof accessRuleGroups.$inferInsert;

export type AccessRuleTimeZoneRow = typeof accessRuleTimeZones.$inferSelect;
export type AccessRuleTimeZoneInsert = typeof accessRuleTimeZones.$inferInsert;

export type AccessRulePortalRow = typeof accessRulePortals.$inferSelect;
export type AccessRulePortalInsert = typeof accessRulePortals.$inferInsert;
