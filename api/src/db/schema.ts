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
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

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
